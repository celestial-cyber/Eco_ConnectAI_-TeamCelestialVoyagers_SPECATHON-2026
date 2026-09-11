import test from 'node:test'
import assert from 'node:assert/strict'
import {
  BATCH_RULES,
  clusterPickups,
  clusterWeight,
  runTrigger,
  planRun,
  assignAgent,
  buildBatches,
  matchIndustry,
} from '../src/lib/batching.js'
import { haversineKm, pathLengthKm } from '../src/lib/geo.js'

const HYD = { lat: 17.4485, lng: 78.3908 } // Hitec City
const hoursAgo = (h) => new Date(Date.now() - h * 3_600_000).toISOString()

function pickup(id, dLat, dLng, kg, ageH = 0.5, extra = {}) {
  return {
    id,
    lat: HYD.lat + dLat,
    lng: HYD.lng + dLng,
    est_weight_kg: kg,
    created_at: hoursAgo(ageH),
    status: 'matched',
    industry_id: 'ind-1',
    waste_type: 'textile',
    ...extra,
  }
}

const industry = {
  id: 'ind-1',
  lat: HYD.lat + 0.06,
  lng: HYD.lng + 0.05,
  verification_status: 'verified',
  waste_types: ['textile', 'paper'],
  areas: [{ lat: HYD.lat, lng: HYD.lng, radius_km: 12 }],
}

const agent = (id, dLat, dLng, cap = 400, status = 'available', radius = 15) => ({
  id,
  lat: HYD.lat + dLat,
  lng: HYD.lng + dLng,
  status,
  radius_km: radius,
  vehicle: { type: 'van', capacity_kg: cap },
})

test('haversine is sane for a known short hop', () => {
  const d = haversineKm(HYD, { lat: HYD.lat + 0.01, lng: HYD.lng })
  assert.ok(d > 1.0 && d < 1.2, `0.01 deg lat should be ~1.11km, got ${d}`)
})

test('clusters split when pickups are further apart than the radius', () => {
  const near = [pickup('a', 0, 0, 10), pickup('b', 0.005, 0.005, 10)]
  const far = [pickup('c', 0.9, 0.9, 10)] // ~130km away
  const clusters = clusterPickups([...near, ...far])
  assert.equal(clusters.length, 2)
  assert.equal(clusters.find((g) => g.length === 2).length, 2)
})

test('a cluster never exceeds MAX_STOPS', () => {
  const many = Array.from({ length: 20 }, (_, i) => pickup('p' + i, i * 0.0004, 0, 5))
  for (const g of clusterPickups(many)) {
    assert.ok(g.length <= BATCH_RULES.MAX_STOPS, `cluster of ${g.length}`)
  }
})

test('trigger fires on bulk weight before stop count', () => {
  const heavy = [pickup('a', 0, 0, 25), pickup('b', 0.002, 0, 25)]
  assert.equal(clusterWeight(heavy), 50)
  assert.equal(runTrigger(heavy), 'bulk_weight')
})

test('trigger fires on stop count for many light items', () => {
  const light = Array.from({ length: 4 }, (_, i) => pickup('p' + i, i * 0.001, 0, 2))
  assert.equal(runTrigger(light), 'stop_count')
})

test('nothing waits past MAX_WAIT_HOURS even if it stays small', () => {
  const lonely = [pickup('a', 0, 0, 3, BATCH_RULES.MAX_WAIT_HOURS + 1)]
  assert.equal(runTrigger(lonely), 'max_wait')
  const fresh = [pickup('b', 0, 0, 3, 0.2)]
  assert.equal(runTrigger(fresh), null)
})

test('planRun beats doing every pickup as its own trip', () => {
  const group = [
    pickup('a', 0.004, 0.004, 12),
    pickup('b', 0.012, 0.002, 12),
    pickup('c', 0.02, 0.011, 12),
    pickup('d', 0.03, 0.02, 12),
  ]
  const plan = planRun({ pickups: group, industry, agentBase: agent('ag-1', -0.02, -0.02) })
  assert.equal(plan.stops.length, 4)
  assert.ok(plan.distance_km < plan.solo_distance_km, 'batched must be shorter than solo')
  assert.ok(plan.saved_pct > 0 && plan.saved_pct < 100)
  assert.equal(plan.weight_kg, 48)
})

test('2-opt ordering is no worse than the greedy seed', () => {
  const group = [
    pickup('a', 0.05, 0.0, 5),
    pickup('b', 0.0, 0.05, 5),
    pickup('c', 0.05, 0.05, 5),
    pickup('d', 0.01, 0.01, 5),
    pickup('e', 0.03, 0.002, 5),
  ]
  const base = agent('ag-1', -0.03, -0.03)
  const plan = planRun({ pickups: group, industry, agentBase: base })
  const asGiven = pathLengthKm([base, ...group, industry, base])
  assert.ok(plan.distance_km <= asGiven + 1e-6, 'optimised route should not be longer')
})

test('agent assignment respects van capacity', () => {
  const group = [pickup('a', 0, 0, 300), pickup('b', 0.002, 0, 300)] // 600kg
  const small = agent('small', 0.001, 0.001, 400)
  const big = agent('big', 0.02, 0.02, 900)
  const picked = assignAgent(group, [small, big], industry)
  assert.equal(picked.agent.id, 'big', 'the 400kg van cannot take 600kg')
})

test('agent assignment ignores agents whose service area does not reach', () => {
  const group = [pickup('a', 0, 0, 50)]
  const outOfRange = agent('far', 0.5, 0.5, 900, 'available', 5) // 70km away, 5km radius
  assert.equal(assignAgent(group, [outOfRange], industry), null)
})

test('offline agents are never assigned', () => {
  const group = [pickup('a', 0, 0, 50)]
  assert.equal(assignAgent(group, [agent('off', 0, 0, 900, 'offline')], industry), null)
})

test('buildBatches explains why a small cluster is still waiting', () => {
  const { runs, waiting } = buildBatches({
    pickups: [pickup('a', 0, 0, 6)],
    industries: [industry],
    agents: [agent('ag-1', 0.001, 0.001)],
  })
  assert.equal(runs.length, 0)
  assert.equal(waiting.length, 1)
  assert.equal(waiting[0].reason, 'below_threshold')
  assert.equal(waiting[0].needs_kg, 34)
  assert.equal(waiting[0].needs_stops, 3)
})

test('buildBatches emits a run once the cluster is bulky enough', () => {
  const pickups = [
    pickup('a', 0.004, 0.004, 18),
    pickup('b', 0.01, 0.006, 18),
    pickup('c', 0.014, 0.012, 18),
  ]
  const { runs, waiting } = buildBatches({
    pickups,
    industries: [industry],
    agents: [agent('ag-1', -0.01, -0.01)],
  })
  assert.equal(waiting.length, 0)
  assert.equal(runs.length, 1)
  assert.equal(runs[0].trigger, 'bulk_weight')
  assert.equal(runs[0].agent_id, 'ag-1')
  assert.equal(runs[0].stops.length, 3)
  assert.equal(runs[0].weight_kg, 54)
})

test('buildBatches reports when no van can take the load', () => {
  const pickups = [pickup('a', 0, 0, 30), pickup('b', 0.003, 0, 30)]
  const { runs, waiting } = buildBatches({
    pickups,
    industries: [industry],
    agents: [agent('tiny', 0.001, 0, 20)],
  })
  assert.equal(runs.length, 0)
  assert.equal(waiting[0].reason, 'no_agent_available')
})

test('unmatched or non-matched pickups are ignored entirely', () => {
  const { runs, waiting } = buildBatches({
    pickups: [
      pickup('a', 0, 0, 90, 0.5, { status: 'requested' }),
      pickup('b', 0, 0, 90, 0.5, { industry_id: null }),
    ],
    industries: [industry],
    agents: [agent('ag-1', 0, 0)],
  })
  assert.equal(runs.length, 0)
  assert.equal(waiting.length, 0)
})

test('matchIndustry needs verification, the right waste type and area cover', () => {
  const p = { lat: HYD.lat, lng: HYD.lng, waste_type: 'textile' }

  assert.equal(matchIndustry(p, [{ ...industry, verification_status: 'pending' }]), null)
  assert.equal(matchIndustry(p, [{ ...industry, waste_types: ['e-waste'] }]), null)
  assert.equal(
    matchIndustry(p, [{ ...industry, areas: [{ lat: HYD.lat + 2, lng: HYD.lng, radius_km: 3 }] }]),
    null
  )
  const ok = matchIndustry(p, [industry])
  assert.equal(ok.industry.id, 'ind-1')
})

test('matchIndustry prefers the closer enrolled area', () => {
  const near = { ...industry, id: 'near', areas: [{ lat: HYD.lat + 0.01, lng: HYD.lng, radius_km: 9 }] }
  const far = { ...industry, id: 'far', areas: [{ lat: HYD.lat + 0.08, lng: HYD.lng, radius_km: 20 }] }
  const got = matchIndustry({ lat: HYD.lat, lng: HYD.lng, waste_type: 'textile' }, [far, near])
  assert.equal(got.industry.id, 'near')
})
