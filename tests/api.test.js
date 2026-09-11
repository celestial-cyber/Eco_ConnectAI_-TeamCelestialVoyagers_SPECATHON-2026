/* End-to-end API tests: boots a real server against a throwaway database
   and walks the whole loop — signup, matching, batching, delivery, points. */

import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { rmSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PORT = 8899
const BASE = `http://127.0.0.1:${PORT}/api`
const dir = mkdtempSync(join(tmpdir(), 'eco-test-'))
let proc

const call = async (path, { token, method = 'GET', body, form } = {}) => {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: form ?? (body ? JSON.stringify(body) : undefined),
  })
  const json = await res.json().catch(() => null)
  return { status: res.status, json }
}

const login = async (email) => {
  const r = await call('/auth/login', { method: 'POST', body: { email, password: 'demo1234' } })
  assert.equal(r.status, 200, `login ${email}: ${JSON.stringify(r.json)}`)
  return r.json.token
}

before(async () => {
  proc = spawn(process.execPath, ['server/index.js'], {
    env: {
      ...process.env,
      PORT: String(PORT),
      DB_FILE: join(dir, 'test.db'),
      JWT_SECRET: 'test-secret',
      BATCH_CRON: 'off',
    },
    stdio: 'ignore',
  })
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASE}/health`)
      if (r.ok) return
    } catch {}
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error('server did not start')
})

after(() => {
  proc?.kill()
  rmSync(dir, { recursive: true, force: true })
})

test('health reports the batching rules the engine actually uses', async () => {
  const { status, json } = await call('/health')
  assert.equal(status, 200)
  assert.equal(json.batch_rules.MIN_BULK_KG, 40)
})

test('protected routes reject anonymous callers', async () => {
  assert.equal((await call('/pickups/mine')).status, 401)
  assert.equal((await call('/notifications')).status, 401)
  assert.equal((await call('/hub')).status, 401)
})

test('login rejects a wrong password without saying which half was wrong', async () => {
  const r = await call('/auth/login', {
    method: 'POST',
    body: { email: 'donor@demo.in', password: 'nope' },
  })
  assert.equal(r.status, 401)
  assert.match(r.json.error, /do not match/)
})

test('signup validates email, password length and role', async () => {
  const bad = [
    { email: 'nope', password: 'demo1234', role: 'user', full_name: 'X' },
    { email: 'a@b.co', password: 'short', role: 'user', full_name: 'X' },
    { email: 'a@b.co', password: 'demo1234', role: 'wizard', full_name: 'X' },
  ]
  for (const body of bad) {
    assert.equal((await call('/auth/signup', { method: 'POST', body })).status, 400)
  }
})

test('a donor cannot reach industry or agent endpoints', async () => {
  const token = await login('donor@demo.in')
  assert.equal((await call('/industries/mine', { token })).status, 403)
  assert.equal((await call('/agents/mine', { token })).status, 403)
  assert.equal((await call('/batch/run', { token, method: 'POST' })).status, 403)
})

test('an industry cannot read another industry’s pickups', async () => {
  const token = await login('industry@demo.in')
  const r = await call('/industries/ind-eparis/pickups', { token })
  assert.equal(r.status, 403)
})

test('a donor creating a pickup gets matched to a covering industry', async () => {
  const token = await login('donor@demo.in')
  const form = new FormData()
  form.set('item_label', 'Cardboard cartons')
  form.set('waste_type', 'paper')
  form.set('condition', '6.5')
  form.set('est_weight_kg', '4.5')
  form.set('lat', '17.4502')
  form.set('lng', '78.3931')

  const r = await call('/pickups', { token, method: 'POST', form })
  assert.equal(r.status, 200, JSON.stringify(r.json))
  assert.equal(r.json.pickup.status, 'matched')
  assert.equal(r.json.match.industry.id, 'ind-goonj')
  assert.ok(r.json.pickup.address, 'address should be resolved server-side')
})

test('a pickup outside every enrolled area stays queued rather than mismatched', async () => {
  const token = await login('donor@demo.in')
  const form = new FormData()
  form.set('item_label', 'Glass jars')
  form.set('waste_type', 'glass')       // nobody accepts glass in the seed
  form.set('est_weight_kg', '2')
  form.set('lat', '17.4502')
  form.set('lng', '78.3931')
  const r = await call('/pickups', { token, method: 'POST', form })
  assert.equal(r.status, 200)
  assert.equal(r.json.pickup.status, 'requested')
  assert.equal(r.json.match, null)
})

test('the server refuses a pickup with no location', async () => {
  const token = await login('donor@demo.in')
  const form = new FormData()
  form.set('item_label', 'Thing')
  form.set('est_weight_kg', '1')
  const r = await call('/pickups', { token, method: 'POST', form })
  assert.equal(r.status, 400)
  assert.match(r.json.error, /location/i)
})

test('batching forms a run and the agent can walk it to delivery', async () => {
  const ind = await login('industry@demo.in')
  const batch = await call('/batch/run', { token: ind, method: 'POST' })
  assert.equal(batch.status, 200)
  assert.ok(batch.json.created.length >= 1, 'expected at least one run')

  const run = batch.json.created[0]
  assert.ok(run.stops.length >= 3)
  assert.ok(run.distance_km < run.solo_distance_km, 'batched route must beat separate trips')
  assert.ok(run.saved_pct > 0)

  const drv = await login('driver@demo.in')
  const mine = await call('/agents/runs', { token: drv })
  assert.equal(mine.status, 200)
  const target = mine.json.find((r) => r.id === run.id)
  assert.ok(target, 'the run should be offered to the assigned agent')

  // wrong order is refused
  assert.equal((await call(`/runs/${run.id}/start`, { token: drv, method: 'POST' })).status, 409)

  assert.equal((await call(`/runs/${run.id}/accept`, { token: drv, method: 'POST' })).status, 200)
  assert.equal((await call(`/runs/${run.id}/start`, { token: drv, method: 'POST' })).status, 200)

  // a bad handover code must not close the run
  const bad = await call(`/runs/${run.id}/deliver`, {
    token: drv, method: 'POST', body: { qr_token: 'WRONG' },
  })
  assert.equal(bad.status, 400)
  assert.match(bad.json.error, /handover code/)

  const before = await call('/auth/me', { token: await login('donor@demo.in') })
  const pointsBefore = before.json.user.eco_points

  const done = await call(`/runs/${run.id}/deliver`, {
    token: drv, method: 'POST', body: { qr_token: target.qr_token },
  })
  assert.equal(done.status, 200, JSON.stringify(done.json))
  assert.equal(done.json.status, 'delivered')

  const after = await call('/auth/me', { token: await login('donor@demo.in') })
  assert.ok(after.json.user.eco_points > pointsBefore, 'points are minted on delivery')

  const hub = await call('/hub', { token: drv })
  assert.ok(hub.json.some((e) => e.run_id === run.id && e.kind === 'run_delivered'))
})

test('another agent cannot touch a run that is not theirs', async () => {
  const drv2 = await login('sunita@demo.in')
  const anyRun = await call('/agents/runs', { token: await login('driver@demo.in') })
  const id = anyRun.json[0]?.id
  assert.ok(id)
  assert.equal((await call(`/runs/${id}/accept`, { token: drv2, method: 'POST' })).status, 403)
})

test('verification is an admin action, not a self-service one', async () => {
  const industryToken = await login('industry@demo.in')
  const mine = await call('/industries/mine', { token: industryToken })
  assert.equal(mine.status, 200)

  // the applicant cannot approve themselves
  const self = await call(`/admin/industries/${mine.json.id}/verify`, {
    token: industryToken, method: 'POST', body: { status: 'verified' },
  })
  assert.equal(self.status, 403)

  const admin = await login('admin@demo.in')
  const r = await call(`/admin/industries/${mine.json.id}/verify`, {
    token: admin, method: 'POST', body: { status: 'verified' },
  })
  assert.equal(r.status, 200)
  assert.equal(r.json.verification_status, 'verified')
})

test('a new industry registers, is unverified, and gets no matches until approved', async () => {
  const email = `ind${Date.now()}@test.in`
  const su = await call('/auth/signup', {
    method: 'POST',
    body: { email, password: 'demo1234', role: 'industry', full_name: 'Test Fibres' },
  })
  assert.equal(su.status, 200)
  const token = su.json.token

  const created = await call('/industries', {
    token, method: 'POST',
    body: {
      name: 'Test Fibres', reg_number: `TS/TEST/${Date.now()}`, address: 'Balanagar',
      lat: 17.472, lng: 78.44, waste_types: ['glass'],
    },
  })
  assert.equal(created.status, 200, JSON.stringify(created.json))
  assert.equal(created.json.verification_status, 'pending')

  await call(`/industries/${created.json.id}/areas`, {
    token, method: 'POST',
    body: { area_name: 'Balanagar', lat: 17.472, lng: 78.44, radius_km: 10 },
  })

  // glass pickup near that area: still unmatched, because the org is unverified
  const donor = await login('donor@demo.in')
  const form = new FormData()
  form.set('item_label', 'Glass bottles')
  form.set('waste_type', 'glass')
  form.set('est_weight_kg', '3')
  form.set('lat', '17.4721')
  form.set('lng', '78.4401')
  const p = await call('/pickups', { token: donor, method: 'POST', form })
  assert.equal(p.json.pickup.status, 'requested')
  assert.equal(p.json.match, null)

  // approve, and the queued pickup is picked up by the rematch
  const admin = await login('admin@demo.in')
  await call(`/admin/industries/${created.json.id}/verify`, {
    token: admin, method: 'POST', body: { status: 'verified' },
  })
  const after = await call('/pickups/mine', { token: donor })
  const same = after.json.find((x) => x.id === p.json.pickup.id)
  assert.equal(same.status, 'matched', 'verifying should rematch what was waiting')
  assert.equal(same.industry_id, created.json.id)
})

test('duplicate registration numbers are rejected', async () => {
  const email = `dup${Date.now()}@test.in`
  const su = await call('/auth/signup', {
    method: 'POST',
    body: { email, password: 'demo1234', role: 'industry', full_name: 'Dup Co' },
  })
  const r = await call('/industries', {
    token: su.json.token, method: 'POST',
    body: {
      name: 'Dup Co', reg_number: 'TS/NGO/2019/4471', address: 'X',
      lat: 17.44, lng: 78.35, waste_types: ['paper'],
    },
  })
  assert.equal(r.status, 400)
  assert.match(r.json.error, /already on file/)
})

test('agent registration issues a code and rejects a duplicate plate', async () => {
  const email = `drv${Date.now()}@test.in`
  const su = await call('/auth/signup', {
    method: 'POST',
    body: { email, password: 'demo1234', role: 'delivery', full_name: 'Test Driver' },
  })
  const token = su.json.token
  const body = {
    service_area_name: 'Kondapur', lat: 17.464, lng: 78.365, radius_km: 10,
    phone: '+91 90000 00000', licence_no: 'TS0120210012345',
    vehicle: { make_model: 'Tata Ace', reg_plate: `TS 09 ZZ ${Date.now() % 9000}`, capacity_kg: 700 },
  }
  const r = await call('/agents', { token, method: 'POST', body })
  assert.equal(r.status, 200, JSON.stringify(r.json))
  assert.match(r.json.agent_code, /^ECO-DA-KON-\d{4}$/)
  assert.equal(r.json.vehicle.vehicle_type, 'van')

  const dupEmail = `drv2${Date.now()}@test.in`
  const su2 = await call('/auth/signup', {
    method: 'POST',
    body: { email: dupEmail, password: 'demo1234', role: 'delivery', full_name: 'Second' },
  })
  const dup = await call('/agents', {
    token: su2.json.token, method: 'POST',
    body: { ...body, vehicle: { ...body.vehicle } },
  })
  assert.equal(dup.status, 400)
  assert.match(dup.json.error, /number plate/)
})

test('classify returns a clear 503 when no vision key is configured', async () => {
  const token = await login('donor@demo.in')
  const form = new FormData()
  form.set('image', new Blob([Uint8Array.from([137, 80, 78, 71])], { type: 'image/png' }), 'x.png')
  const r = await call('/classify', { token, method: 'POST', form })
  assert.equal(r.status, 503)
  assert.match(r.json.error, /GEMINI_API_KEY/)
})
