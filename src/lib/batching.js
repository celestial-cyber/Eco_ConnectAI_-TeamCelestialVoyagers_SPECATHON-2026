/* ============================================================
   Bulk-pickup batching engine
   ------------------------------------------------------------
   The rule from the spec: a delivery agent should never make a
   trip for one bag. Pickups wait until enough of them near each
   other are heading to the same industry, then they go out as a
   single ordered run.

   Everything here is pure — no network, no React — so it can be
   unit tested and later lifted into a Postgres function or an
   edge cron job unchanged.
   ============================================================ */

import { haversineKm, centroid, pathLengthKm, nearestNeighbourOrder, twoOpt } from './geo.js'

export const BATCH_RULES = {
  /** A run may leave once it carries at least this much. */
  MIN_BULK_KG: 40,
  /** ...or once it has at least this many stops, however light. */
  MIN_STOPS: 4,
  /** Hard ceiling per run, so one agent is never buried. */
  MAX_STOPS: 8,
  /** Pickups only batch together inside this radius. */
  CLUSTER_RADIUS_KM: 4,
  /** Nothing waits longer than this, even if the run stays small. */
  MAX_WAIT_HOURS: 6,
}

/**
 * Group pickups that are close to each other into candidate clusters.
 * Greedy: seed with the oldest waiting pickup, absorb anything within
 * radius of the running centroid, stop at MAX_STOPS.
 */
export function clusterPickups(pickups, rules = BATCH_RULES) {
  const left = pickups
    .slice()
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
  const clusters = []

  while (left.length) {
    const seed = left.shift()
    const group = [seed]
    let centre = { lat: seed.lat, lng: seed.lng }

    let moved = true
    while (moved && group.length < rules.MAX_STOPS) {
      moved = false
      for (let i = 0; i < left.length; i++) {
        if (haversineKm(centre, left[i]) <= rules.CLUSTER_RADIUS_KM) {
          group.push(left.splice(i, 1)[0])
          centre = centroid(group)
          moved = true
          break
        }
      }
    }
    clusters.push(group)
  }
  return clusters
}

/** Total declared weight of a cluster. */
export const clusterWeight = (group) =>
  group.reduce((s, p) => s + (Number(p.est_weight_kg) || 0), 0)

/** Age in hours of the longest-waiting pickup in the cluster. */
export function oldestWaitHours(group, now = Date.now()) {
  let oldest = 0
  for (const p of group) {
    const h = (now - new Date(p.created_at).getTime()) / 3_600_000
    if (h > oldest) oldest = h
  }
  return oldest
}

/**
 * Should this cluster go out yet? Returns the reason it fired, or null.
 * Three ways to trigger — bulk, stop count, or the anti-starvation timer.
 */
export function runTrigger(group, now = Date.now(), rules = BATCH_RULES) {
  if (clusterWeight(group) >= rules.MIN_BULK_KG) return 'bulk_weight'
  if (group.length >= rules.MIN_STOPS) return 'stop_count'
  if (oldestWaitHours(group, now) >= rules.MAX_WAIT_HOURS) return 'max_wait'
  return null
}

/**
 * Order the stops and work out what the batching actually saved.
 *
 * batched : base -> stop1 -> ... -> stopN -> industry -> base
 * solo    : for each pickup, base -> pickup -> industry -> base
 *
 * The solo figure is what these pickups would have cost as individual
 * trips, which is the thing the run is being compared against.
 */
export function planRun({ pickups, industry, agentBase }) {
  const base = agentBase || industry
  const seeded = nearestNeighbourOrder(base, pickups)
  const ordered = twoOpt(base, seeded, industry)

  const batchedKm = pathLengthKm([base, ...ordered, industry, base])
  const soloKm = pickups.reduce(
    (s, p) =>
      s + haversineKm(base, p) + haversineKm(p, industry) + haversineKm(industry, base),
    0
  )
  const savedPct = soloKm > 0 ? Math.max(0, (1 - batchedKm / soloKm) * 100) : 0

  return {
    stops: ordered,
    distance_km: round1(batchedKm),
    solo_distance_km: round1(soloKm),
    saved_pct: Math.round(savedPct),
    weight_kg: round1(clusterWeight(pickups)),
  }
}

/**
 * Pick the agent for a cluster: available, van big enough, and the
 * cluster centre must fall inside the area they registered for.
 * Nearest one wins.
 */
export function assignAgent(group, agents, industry) {
  const centre = centroid(group)
  const weight = clusterWeight(group)
  const eligible = agents
    .filter((a) => a.status === 'available')
    .filter((a) => (a.vehicle?.capacity_kg ?? 0) >= weight)
    .map((a) => ({ agent: a, d: haversineKm(centre, a) }))
    .filter(({ agent, d }) => d <= (agent.radius_km ?? 0))
    .sort((x, y) => x.d - y.d)

  if (!eligible.length) return null
  return { agent: eligible[0].agent, distance_km: round1(eligible[0].d) }
}

/**
 * Full pass: everything waiting -> proposed runs.
 * Pickups whose cluster has not triggered yet, or that no agent can
 * take, are returned as `waiting` with the reason, so the UI can be
 * honest about why nothing is moving.
 */
export function buildBatches({ pickups, industries, agents, now = Date.now(), rules = BATCH_RULES }) {
  const runs = []
  const waiting = []

  const byIndustry = new Map()
  for (const p of pickups) {
    if (p.status !== 'matched' || !p.industry_id) continue
    if (!byIndustry.has(p.industry_id)) byIndustry.set(p.industry_id, [])
    byIndustry.get(p.industry_id).push(p)
  }

  for (const [industryId, list] of byIndustry) {
    const industry = industries.find((i) => i.id === industryId)
    if (!industry) continue

    for (const group of clusterPickups(list, rules)) {
      const trigger = runTrigger(group, now, rules)
      if (!trigger) {
        waiting.push({
          industry_id: industryId,
          pickups: group,
          reason: 'below_threshold',
          weight_kg: round1(clusterWeight(group)),
          needs_kg: round1(Math.max(0, rules.MIN_BULK_KG - clusterWeight(group))),
          needs_stops: Math.max(0, rules.MIN_STOPS - group.length),
        })
        continue
      }

      const picked = assignAgent(group, agents, industry)
      if (!picked) {
        waiting.push({
          industry_id: industryId,
          pickups: group,
          reason: 'no_agent_available',
          weight_kg: round1(clusterWeight(group)),
        })
        continue
      }

      const plan = planRun({ pickups: group, industry, agentBase: picked.agent })
      runs.push({
        industry_id: industryId,
        agent_id: picked.agent.id,
        trigger,
        ...plan,
      })
    }
  }

  return { runs, waiting }
}

/**
 * Which industry should take this item? Verified, accepts the waste
 * type, and has enrolled an area that actually covers the pickup point.
 * Closest match wins; ties broken by shorter distance.
 */
export function matchIndustry(pickup, industries) {
  const ranked = industries
    .filter((i) => i.verification_status === 'verified')
    .filter((i) => (i.waste_types || []).includes(pickup.waste_type))
    .map((i) => {
      const areas = i.areas || []
      let best = Infinity
      for (const a of areas) {
        const d = haversineKm(pickup, a)
        if (d <= (a.radius_km ?? 0) && d < best) best = d
      }
      return { industry: i, d: best }
    })
    .filter((x) => x.d !== Infinity)
    .sort((a, b) => a.d - b.d)

  if (!ranked.length) return null
  return { industry: ranked[0].industry, distance_km: round1(ranked[0].d) }
}

const round1 = (n) => Math.round(n * 10) / 10
