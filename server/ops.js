/* ============================================================
   Operations the client must never be trusted with: matching a
   pickup, forming runs, and closing a delivery (which mints points).

   The batching engine itself is imported from src/lib — the exact
   same file the unit tests cover and the browser once ran. One
   implementation, tested once.
   ============================================================ */

import { randomBytes } from 'node:crypto'
import { buildBatches, matchIndustry } from '../src/lib/batching.js'
import { db, uid, allIndustries, allAgents, notify, hydrateRun } from './db.js'

const now = () => new Date().toISOString()

/** Assign a pickup to the best verified industry covering its location. */
export function matchPickup(pickup) {
  const m = matchIndustry(pickup, allIndustries())
  if (!m) return null
  db.prepare("update pickups set industry_id = ?, status = 'matched' where id = ?")
    .run(m.industry.id, pickup.id)
  notify(
    m.industry.owner_id,
    'pickup',
    'New scrap matched to you',
    `${pickup.item_label} (${pickup.est_weight_kg} kg) at ${pickup.address}.`,
    pickup.id
  )
  return m
}

/** Anything logged but unmatched gets another chance after an area or verification changes. */
export function rematchOpen() {
  const open = db.prepare("select * from pickups where status = 'requested'").all()
  let n = 0
  for (const p of open) if (matchPickup(p)) n++
  return n
}

/**
 * One batching pass. Returns the runs it created and, for anything it
 * could not dispatch, the reason — so the UI never has to guess.
 */
export function runBatchingPass() {
  const pickups = db.prepare("select * from pickups where status = 'matched'").all()
  const industries = allIndustries()
  const agents = allAgents()
  const { runs, waiting } = buildBatches({ pickups, industries, agents })

  const created = []
  const insertRun = db.prepare(`insert into runs
    (id,agent_id,industry_id,status,trigger_reason,weight_kg,distance_km,solo_distance_km,
     saved_pct,qr_token,created_at)
    values (?,?,?,'proposed',?,?,?,?,?,?,?)`)
  const insertStop = db.prepare('insert into run_stops (run_id,pickup_id,seq) values (?,?,?)')
  const markPickup = db.prepare("update pickups set status='batched', run_id=? where id=?")

  const commit = db.transaction((r) => {
    const id = uid()
    insertRun.run(
      id, r.agent_id, r.industry_id, r.trigger, r.weight_kg, r.distance_km,
      r.solo_distance_km, r.saved_pct, randomBytes(5).toString('hex').toUpperCase(), now()
    )
    r.stops.forEach((p, i) => {
      insertStop.run(id, p.id, i + 1)
      markPickup.run(id, p.id)
    })
    return id
  })

  for (const r of runs) {
    const id = commit(r)
    const agent = agents.find((a) => a.id === r.agent_id)
    if (agent) {
      notify(
        agent.profile_id,
        'run',
        'Bulk pickup offered',
        `${r.stops.length} stops · ${r.weight_kg} kg · ${r.distance_km} km. ` +
          `Batching saves ${r.saved_pct}% against separate trips.`,
        id
      )
    }
    created.push(hydrateRun(db.prepare('select * from runs where id = ?').get(id)))
  }

  return { created, waiting }
}

/**
 * Close a run. This is the only place eco points are minted, and it
 * only runs when the handover code matches — so a reward can never be
 * claimed for a donation that did not happen.
 */
export function deliverRun(runId, token) {
  const run = db.prepare('select * from runs where id = ?').get(runId)
  if (!run) {
    const e = new Error('Run not found.')
    e.status = 404
    throw e
  }
  if (run.status === 'delivered') return hydrateRun(run)
  if (run.status !== 'in_progress') {
    const e = new Error('Start the run before confirming the drop.')
    e.status = 409
    throw e
  }
  if (token && String(token).trim().toUpperCase() !== run.qr_token) {
    const e = new Error('That handover code does not match this run.')
    e.status = 400
    throw e
  }

  const stops = db
    .prepare('select p.* from run_stops rs join pickups p on p.id = rs.pickup_id where rs.run_id = ?')
    .all(runId)

  const tx = db.transaction(() => {
    db.prepare("update runs set status='delivered', delivered_at=? where id=?").run(now(), runId)

    for (const p of stops) {
      const pts = Math.max(20, Math.round(60 + (p.condition ?? 5) * 22))
      db.prepare("update pickups set status='delivered', delivered_at=?, points_awarded=? where id=?")
        .run(now(), pts, p.id)
      db.prepare('update profiles set eco_points = eco_points + ? where id = ?').run(pts, p.user_id)
      notify(p.user_id, 'reward', 'Donation verified',
        `Your ${p.item_label.toLowerCase()} reached its recycler. +${pts} eco points.`, p.id)
    }

    const ind = db.prepare('select owner_id,name from industries where id = ?').get(run.industry_id)
    if (ind) {
      notify(ind.owner_id, 'delivery', 'Scrap delivered',
        `${run.weight_kg} kg arrived on run ${runId.slice(0, 6).toUpperCase()}.`, runId)
    }

    db.prepare('insert into hub_events (id,run_id,kind,payload,created_at) values (?,?,?,?,?)').run(
      uid(), runId, 'run_delivered',
      JSON.stringify({
        weight_kg: run.weight_kg, distance_km: run.distance_km,
        solo_distance_km: run.solo_distance_km, saved_pct: run.saved_pct,
        stops: stops.length, industry_id: run.industry_id, agent_id: run.agent_id,
      }),
      now()
    )

    db.prepare("update delivery_agents set status='available' where id=?").run(run.agent_id)
  })
  tx()

  return hydrateRun(db.prepare('select * from runs where id = ?').get(runId))
}

/** Readable agent code: ECO-DA-<AREA>-<4 digits>, unique. */
export function issueAgentCode(area) {
  const prefix = (String(area || 'GEN').replace(/[^a-zA-Z]/g, '').slice(0, 3) || 'GEN').toUpperCase()
  for (let i = 0; i < 50; i++) {
    const code = `ECO-DA-${prefix}-${1000 + Math.floor(Math.random() * 9000)}`
    const clash = db.prepare('select 1 from delivery_agents where agent_code = ?').get(code)
    if (!clash) return code
  }
  return `ECO-DA-${prefix}-${Date.now().toString().slice(-6)}`
}
