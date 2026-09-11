/* ============================================================
   EcoConnect AI — API server
   Express + SQLite + JWT. Holds every secret (Gemini key, geocoder
   identity) and every decision the client must not be trusted with
   (matching, batching, minting points).
   ============================================================ */

import express from 'express'
import cors from 'cors'
import multer from 'multer'
import cron from 'node-cron'
import { mkdirSync, existsSync, writeFileSync, createReadStream } from 'node:fs'
import { resolve, extname } from 'node:path'

import {
  db, uid, seedIfEmpty, allIndustries, getIndustryFull, hydrateIndustry,
  hydrateAgent, hydrateRun, notify, publicUser,
} from './db.js'
import {
  signToken, hash, check, attachUser, requireAuth, requireRole, ownsIndustry, ownsRun,
} from './auth.js'
import { classifyBuffer, hasVision, modelName, provider, describeVision } from './vision.js'
import { reverseGeocode } from './geo.js'
import { matchPickup, rematchOpen, runBatchingPass, deliverRun, issueAgentCode } from './ops.js'
import { BATCH_RULES } from '../src/lib/batching.js'

const PORT = Number(process.env.PORT || 8787)
const UPLOADS = resolve('data/uploads')
mkdirSync(UPLOADS, { recursive: true })

const app = express()
app.use(cors({ origin: process.env.CORS_ORIGIN || true }))
app.use(express.json({ limit: '2mb' }))
app.use(attachUser)

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter: (_req, file, cb) =>
    /^image\//.test(file.mimetype) ? cb(null, true) : cb(new Error('Only image files are accepted.')),
})

const now = () => new Date().toISOString()
const ok = (res, data) => res.json(data)
const fail = (res, e) => res.status(e.status || 400).json({ error: e.message })

/* ============================================================
   meta
   ============================================================ */
app.get('/api/health', (_req, res) =>
  ok(res, {
    ok: true,
    vision: describeVision(),
    batch_rules: BATCH_RULES,
    time: now(),
  })
)

/* ============================================================
   auth
   ============================================================ */
app.post('/api/auth/signup', (req, res) => {
  try {
    const { email, password, role, full_name, phone } = req.body || {}
    if (!/^\S+@\S+\.\S+$/.test(String(email || ''))) throw new Error('Enter a valid email address.')
    if (String(password || '').length < 8) throw new Error('Use at least 8 characters for the password.')
    if (!['user', 'industry', 'delivery'].includes(role)) throw new Error('Pick a valid account type.')
    if (!String(full_name || '').trim()) throw new Error('Your name is required.')

    const exists = db.prepare('select 1 from profiles where email = ?').get(email)
    if (exists) throw new Error('An account already exists for that email.')

    const id = uid()
    db.prepare(
      `insert into profiles (id,email,password,role,full_name,phone,eco_points,created_at)
       values (?,?,?,?,?,?,0,?)`
    ).run(id, String(email).trim().toLowerCase(), hash(password), role, String(full_name).trim(),
      phone || '', now())

    const user = publicUser(db.prepare('select * from profiles where id = ?').get(id))
    ok(res, { user, token: signToken(user) })
  } catch (e) {
    fail(res, e)
  }
})

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {}
  const row = db.prepare('select * from profiles where email = ?').get(String(email || '').trim())
  // Same message either way — never reveal which half was wrong.
  if (!row || !check(String(password || ''), row.password)) {
    return res.status(401).json({ error: 'That email and password do not match.' })
  }
  const user = publicUser(row)
  ok(res, { user, token: signToken(user) })
})

app.get('/api/auth/me', requireAuth, (req, res) => ok(res, { user: req.user }))

/* ============================================================
   geocoding
   ============================================================ */
app.get('/api/geo/reverse', requireAuth, async (req, res) => {
  const lat = Number(req.query.lat)
  const lng = Number(req.query.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return res.status(400).json({ error: 'lat and lng are required and must be valid coordinates.' })
  }
  ok(res, await reverseGeocode(lat, lng))
})

/* ============================================================
   vision
   ============================================================ */
app.post('/api/classify', requireAuth, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) throw Object.assign(new Error('Attach an image as `image`.'), { status: 400 })
    ok(res, await classifyBuffer(req.file.buffer, req.file.mimetype))
  } catch (e) {
    fail(res, e)
  }
})

/* ============================================================
   pickups
   ============================================================ */
app.post('/api/pickups', requireRole('user'), upload.single('photo'), async (req, res) => {
  try {
    const b = req.body || {}
    const lat = Number(b.lat)
    const lng = Number(b.lng)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error('A location is required.')
    if (!String(b.item_label || '').trim()) throw new Error('Name the item.')
    const weight = Number(b.est_weight_kg)
    if (!(weight > 0)) throw new Error('Weight must be greater than zero.')

    let photo_path = null
    if (req.file) {
      const name = `${uid()}${extname(req.file.originalname) || '.jpg'}`
      writeFileSync(resolve(UPLOADS, name), req.file.buffer)
      photo_path = name
    }

    // Trust the address the client sends only as a hint; resolve it server-side.
    const geo = await reverseGeocode(lat, lng)
    const address = geo.address || String(b.address || '').trim() || `${lat.toFixed(4)}, ${lng.toFixed(4)}`

    const id = uid()
    db.prepare(
      `insert into pickups (id,user_id,photo_path,item_label,waste_type,condition,pathway,
        confidence,est_weight_kg,address,lat,lng,accuracy_m,status,created_at)
       values (?,?,?,?,?,?,?,?,?,?,?,?,?,'requested',?)`
    ).run(
      id, req.user.id, photo_path, String(b.item_label).trim().slice(0, 80),
      String(b.waste_type || 'textile'), num(b.condition), b.pathway || null,
      num(b.confidence), weight, address, lat, lng, num(b.accuracy_m), now()
    )

    const pickup = db.prepare('select * from pickups where id = ?').get(id)
    const match = matchPickup(pickup)
    ok(res, {
      pickup: db.prepare('select * from pickups where id = ?').get(id),
      match: match && { industry: match.industry, distance_km: match.distance_km },
      geocode: geo,
    })
  } catch (e) {
    fail(res, e)
  }
})

app.get('/api/pickups/mine', requireAuth, (req, res) =>
  ok(res, db.prepare('select * from pickups where user_id = ? order by created_at desc').all(req.user.id))
)

app.post('/api/pickups/:id/cancel', requireAuth, (req, res) => {
  const row = db.prepare('select * from pickups where id = ?').get(req.params.id)
  if (!row || row.user_id !== req.user.id) return res.status(403).json({ error: 'Not your pickup.' })
  if (!['requested', 'matched'].includes(row.status)) {
    return res.status(409).json({ error: 'It is already in a run — call the collector instead.' })
  }
  db.prepare("update pickups set status='cancelled' where id=?").run(row.id)
  ok(res, { id: row.id, status: 'cancelled' })
})

/** Photos are not public: only the donor, the matched industry or the assigned agent. */
app.get('/api/pickups/:id/photo', requireAuth, (req, res) => {
  const p = db.prepare('select * from pickups where id = ?').get(req.params.id)
  if (!p?.photo_path) return res.status(404).end()

  const isOwner = p.user_id === req.user.id
  const isIndustry = !!db
    .prepare('select 1 from industries where id = ? and owner_id = ?')
    .get(p.industry_id, req.user.id)
  const isAgent = !!db
    .prepare(
      `select 1 from run_stops rs join runs r on r.id = rs.run_id
         join delivery_agents a on a.id = r.agent_id
        where rs.pickup_id = ? and a.profile_id = ?`
    )
    .get(p.id, req.user.id)

  if (!isOwner && !isIndustry && !isAgent && req.user.role !== 'admin') {
    return res.status(403).end()
  }
  const file = resolve(UPLOADS, p.photo_path)
  if (!existsSync(file)) return res.status(404).end()
  createReadStream(file).pipe(res)
})

/* ============================================================
   industries
   ============================================================ */
app.get('/api/industries/mine', requireRole('industry'), (req, res) => {
  const row = db.prepare('select * from industries where owner_id = ?').get(req.user.id)
  ok(res, row ? hydrateIndustry(row) : null)
})

app.get('/api/industries', requireAuth, (_req, res) => ok(res, allIndustries()))

app.post('/api/industries', requireRole('industry'), (req, res) => {
  try {
    const b = req.body || {}
    const already = db.prepare('select 1 from industries where owner_id = ?').get(req.user.id)
    if (already) throw new Error('You already have an organisation registered.')
    if (!String(b.name || '').trim()) throw new Error('Organisation name is required.')
    if (!String(b.reg_number || '').trim()) throw new Error('Registration number is required.')
    if (db.prepare('select 1 from industries where reg_number = ?').get(b.reg_number.trim())) {
      throw new Error('That registration number is already on file.')
    }
    if (!Number.isFinite(Number(b.lat))) throw new Error('Place your location on the map.')

    const id = uid()
    db.prepare(
      `insert into industries (id,owner_id,name,org_type,reg_number,gst_number,contact_person,
        phone,contact_email,address,city,pincode,lat,lng,capacity_kg_month,doc_ref,
        verification_status,created_at)
       values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',?)`
    ).run(
      id, req.user.id, b.name.trim(), b.org_type || 'ngo', b.reg_number.trim(),
      b.gst_number || null, b.contact_person || null, b.phone || null, b.contact_email || null,
      String(b.address || '').trim(), b.city || null, b.pincode || null,
      Number(b.lat), Number(b.lng), num(b.capacity_kg_month), b.doc_ref || null, now()
    )
    setWasteTypes(id, b.waste_types)
    ok(res, getIndustryFull(id))
  } catch (e) {
    fail(res, e)
  }
})

app.patch('/api/industries/:id', requireRole('industry', 'admin'), ownsIndustry, (req, res) => {
  try {
    const b = req.body || {}
    const cols = ['name', 'org_type', 'reg_number', 'gst_number', 'contact_person', 'phone',
      'contact_email', 'address', 'city', 'pincode', 'lat', 'lng', 'capacity_kg_month', 'doc_ref']
    const sets = []
    const vals = []
    for (const c of cols) {
      if (b[c] !== undefined) {
        sets.push(`${c} = ?`)
        vals.push(b[c])
      }
    }
    if (b.reg_number) {
      const clash = db.prepare('select 1 from industries where reg_number = ? and id <> ?')
        .get(b.reg_number, req.params.id)
      if (clash) throw new Error('That registration number is already on file.')
    }
    if (sets.length) {
      db.prepare(`update industries set ${sets.join(', ')} where id = ?`).run(...vals, req.params.id)
    }
    if (Array.isArray(b.waste_types)) setWasteTypes(req.params.id, b.waste_types)
    ok(res, getIndustryFull(req.params.id))
  } catch (e) {
    fail(res, e)
  }
})

app.post('/api/industries/:id/areas', requireRole('industry'), ownsIndustry, (req, res) => {
  try {
    const b = req.body || {}
    if (!String(b.area_name || '').trim()) throw new Error('Name the area.')
    if (!Number.isFinite(Number(b.lat))) throw new Error('Place the area on the map.')
    const r = Number(b.radius_km)
    if (!(r > 0 && r <= 60)) throw new Error('Radius must be between 1 and 60 km.')
    db.prepare(
      'insert into industry_areas (id,industry_id,area_name,lat,lng,radius_km,created_at) values (?,?,?,?,?,?,?)'
    ).run(uid(), req.params.id, b.area_name.trim(), Number(b.lat), Number(b.lng), r, now())
    rematchOpen()
    ok(res, getIndustryFull(req.params.id))
  } catch (e) {
    fail(res, e)
  }
})

app.delete('/api/industries/:id/areas/:areaId', requireRole('industry'), ownsIndustry, (req, res) => {
  db.prepare('delete from industry_areas where id = ? and industry_id = ?')
    .run(req.params.areaId, req.params.id)
  ok(res, getIndustryFull(req.params.id))
})

app.get('/api/industries/:id/pickups', requireRole('industry', 'admin'), ownsIndustry, (req, res) =>
  ok(res, db.prepare('select * from pickups where industry_id = ? order by created_at desc').all(req.params.id))
)

app.get('/api/industries/:id/runs', requireRole('industry', 'admin'), ownsIndustry, (req, res) =>
  ok(res, db.prepare('select * from runs where industry_id = ? order by created_at desc')
    .all(req.params.id).map(hydrateRun))
)

function setWasteTypes(industryId, list) {
  if (!Array.isArray(list)) return
  db.prepare('delete from industry_waste_types where industry_id = ?').run(industryId)
  const ins = db.prepare('insert or ignore into industry_waste_types values (?,?)')
  for (const w of list) ins.run(industryId, String(w))
}

/* ============================================================
   admin — verification lives here, not in the applicant's own portal
   ============================================================ */
app.get('/api/admin/industries', requireRole('admin'), (_req, res) =>
  ok(res, allIndustries())
)

app.post('/api/admin/industries/:id/verify', requireRole('admin'), (req, res) => {
  const { status, note } = req.body || {}
  if (!['verified', 'rejected', 'pending'].includes(status)) {
    return res.status(400).json({ error: 'status must be verified, rejected or pending.' })
  }
  const ind = db.prepare('select * from industries where id = ?').get(req.params.id)
  if (!ind) return res.status(404).json({ error: 'Organisation not found.' })

  db.prepare('update industries set verification_status=?, verification_note=?, verified_at=? where id=?')
    .run(status, note || null, status === 'verified' ? now() : null, req.params.id)

  notify(ind.owner_id, 'verification',
    status === 'verified' ? 'Organisation verified' : `Verification ${status}`,
    status === 'verified'
      ? 'You now receive matching scrap from your enrolled areas.'
      : note || 'The registration details could not be confirmed.',
    ind.id)

  if (status === 'verified') rematchOpen()
  ok(res, getIndustryFull(req.params.id))
})

/* ============================================================
   delivery agents
   ============================================================ */
app.get('/api/agents/mine', requireRole('delivery'), (req, res) => {
  const row = db.prepare('select * from delivery_agents where profile_id = ?').get(req.user.id)
  ok(res, row ? hydrateAgent(row) : null)
})

app.post('/api/agents', requireRole('delivery'), (req, res) => {
  try {
    const b = req.body || {}
    const v = b.vehicle || {}
    if (db.prepare('select 1 from delivery_agents where profile_id = ?').get(req.user.id)) {
      throw new Error('You are already registered as an agent.')
    }
    if (!String(b.service_area_name || '').trim()) throw new Error('Name your service area.')
    if (!Number.isFinite(Number(b.lat))) throw new Error('Place your area on the map.')
    if (!String(v.make_model || '').trim()) throw new Error('Vehicle make and model are required.')
    if (!String(v.reg_plate || '').trim()) throw new Error('Number plate is required.')
    if (!(Number(v.capacity_kg) >= 50)) throw new Error('A van should carry at least 50 kg.')
    const plate = String(v.reg_plate).trim().toUpperCase()
    if (db.prepare('select 1 from vehicles where reg_plate = ?').get(plate)) {
      throw new Error('That number plate is already registered.')
    }

    const id = uid()
    const code = issueAgentCode(b.service_area_name)
    db.prepare(
      `insert into delivery_agents (id,profile_id,agent_code,service_area_name,lat,lng,radius_km,
        phone,licence_no,status,created_at) values (?,?,?,?,?,?,?,?,?,'available',?)`
    ).run(id, req.user.id, code, String(b.service_area_name).trim(), Number(b.lat), Number(b.lng),
      Number(b.radius_km) || 10, b.phone || null, b.licence_no || null, now())

    db.prepare(
      `insert into vehicles (id,agent_id,vehicle_type,make_model,reg_plate,capacity_kg,insurance_expiry)
       values (?,?,'van',?,?,?,?)`
    ).run(uid(), id, String(v.make_model).trim(), plate, Number(v.capacity_kg), v.insurance_expiry || null)

    ok(res, hydrateAgent(db.prepare('select * from delivery_agents where id = ?').get(id)))
  } catch (e) {
    fail(res, e)
  }
})

app.patch('/api/agents/status', requireRole('delivery'), (req, res) => {
  const { status } = req.body || {}
  if (!['offline', 'available'].includes(status)) {
    return res.status(400).json({ error: 'status must be offline or available.' })
  }
  const a = db.prepare('select * from delivery_agents where profile_id = ?').get(req.user.id)
  if (!a) return res.status(404).json({ error: 'Register as an agent first.' })
  if (a.status === 'on_run') {
    return res.status(409).json({ error: 'Finish your current run before going off duty.' })
  }
  db.prepare('update delivery_agents set status = ? where id = ?').run(status, a.id)
  ok(res, hydrateAgent(db.prepare('select * from delivery_agents where id = ?').get(a.id)))
})

app.get('/api/agents/runs', requireRole('delivery'), (req, res) => {
  const a = db.prepare('select * from delivery_agents where profile_id = ?').get(req.user.id)
  if (!a) return ok(res, [])
  ok(res, db.prepare('select * from runs where agent_id = ? order by created_at desc')
    .all(a.id).map(hydrateRun))
})

/* ============================================================
   runs
   ============================================================ */
app.post('/api/runs/:id/accept', requireRole('delivery'), ownsRun, (req, res) => {
  const r = db.prepare('select * from runs where id = ?').get(req.params.id)
  if (r.status !== 'proposed') return res.status(409).json({ error: 'That run is no longer on offer.' })
  db.prepare("update runs set status='accepted', accepted_at=? where id=?").run(now(), r.id)
  db.prepare("update delivery_agents set status='on_run' where id=?").run(r.agent_id)
  ok(res, hydrateRun(db.prepare('select * from runs where id = ?').get(r.id)))
})

app.post('/api/runs/:id/start', requireRole('delivery'), ownsRun, (req, res) => {
  const r = db.prepare('select * from runs where id = ?').get(req.params.id)
  if (r.status !== 'accepted') return res.status(409).json({ error: 'Accept the run first.' })
  db.transaction(() => {
    db.prepare("update runs set status='in_progress' where id=?").run(r.id)
    db.prepare(
      "update pickups set status='picked' where id in (select pickup_id from run_stops where run_id=?)"
    ).run(r.id)
  })()
  ok(res, hydrateRun(db.prepare('select * from runs where id = ?').get(r.id)))
})

app.post('/api/runs/:id/stops/:pickupId/picked', requireRole('delivery'), ownsRun, (req, res) => {
  db.prepare('update run_stops set picked_at = ? where run_id = ? and pickup_id = ?')
    .run(now(), req.params.id, req.params.pickupId)
  ok(res, hydrateRun(db.prepare('select * from runs where id = ?').get(req.params.id)))
})

app.post('/api/runs/:id/deliver', requireRole('delivery'), ownsRun, (req, res) => {
  try {
    ok(res, deliverRun(req.params.id, req.body?.qr_token))
  } catch (e) {
    fail(res, e)
  }
})

/* ============================================================
   batching — normally the cron does this; the route is for demos
   ============================================================ */
app.post('/api/batch/run', requireRole('industry', 'admin'), (_req, res) => {
  ok(res, runBatchingPass())
})

/* ============================================================
   notifications + hub
   ============================================================ */
app.get('/api/notifications', requireAuth, (req, res) =>
  ok(res, db.prepare('select * from notifications where profile_id = ? order by created_at desc limit 60')
    .all(req.user.id).map((n) => ({ ...n, read: !!n.read })))
)

app.post('/api/notifications/read', requireAuth, (req, res) => {
  db.prepare('update notifications set read = 1 where profile_id = ?').run(req.user.id)
  ok(res, { ok: true })
})

app.get('/api/hub', requireAuth, (_req, res) =>
  ok(res, db.prepare('select * from hub_events order by created_at desc limit 60')
    .all().map((e) => ({ ...e, payload: safeParse(e.payload) })))
)

/* ============================================================
   static build (production)
   ============================================================ */
const dist = resolve('dist')
if (existsSync(dist)) {
  app.use(express.static(dist))
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(resolve(dist, 'index.html')))
}

app.use((err, _req, res, _next) => {
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'That image is larger than 12 MB.' })
  }
  res.status(500).json({ error: err?.message || 'Something went wrong on the server.' })
})

/* ============================================================
   boot
   ============================================================ */
const num = (v) => (v === undefined || v === null || v === '' ? null : Number(v))
const safeParse = (s) => {
  try {
    return JSON.parse(s)
  } catch {
    return {}
  }
}

if (seedIfEmpty()) {
  // Seeded pickups start unmatched; run the matcher once so the demo opens
  // in a believable state instead of an empty queue.
  console.log(`[db] seeded demo data, matched ${rematchOpen()} pickup(s)`)
}

// Batching is a scheduled job, not a button. The route above stays for demos.
const SCHEDULE = process.env.BATCH_CRON || '*/2 * * * *'
if (process.env.BATCH_CRON !== 'off') {
  cron.schedule(SCHEDULE, () => {
    try {
      const { created } = runBatchingPass()
      if (created.length) console.log(`[batch] created ${created.length} run(s)`)
    } catch (e) {
      console.error('[batch] failed:', e.message)
    }
  })
}

app.listen(PORT, () => {
  console.log(`[api] http://localhost:${PORT}`)
  console.log(`[api] vision: ${hasVision ? `${provider} · ${modelName}` : 'not configured — set GEMINI_API_KEY or OPENAI_API_KEY'}`)
  console.log(`[api] batching cron: ${process.env.BATCH_CRON === 'off' ? 'off' : SCHEDULE}`)
})

export default app
