import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Page } from '../components/Shell.jsx'
import MapPlot from '../components/MapPlot.jsx'
import LocationPicker from '../components/LocationPicker.jsx'
import { useGeolocation } from '../hooks/useGeolocation.js'
import {
  Banner, Card, Chip, Empty, Field, KV, Stat, useToast, ago, kg, km,
} from '../components/ui.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { db } from '../lib/db.js'
import { RUN_STATUS, TRIGGER_LABEL, wasteLabel } from '../lib/waste.js'

function useAgent() {
  const { user } = useAuth()
  const [agent, setAgent] = useState(undefined)
  const reload = useCallback(
    () => db.getMyAgent(user.id).then(setAgent).catch(() => setAgent(null)),
    [user.id]
  )
  useEffect(() => { reload() }, [reload])
  return { agent, reload }
}

function NeedsAgent() {
  return (
    <Card>
      <Empty title="You are not registered as an agent yet">
        Register your service area and your van to receive batched pickups.
        <div style={{ marginTop: 18 }}>
          <Link className="btn" to="/d/profile">Register as a delivery agent</Link>
        </div>
      </Empty>
    </Card>
  )
}

export function DeliveryHome() {
  const { agent, reload } = useAgent()
  const [runs, setRuns] = useState([])
  const toast = useToast()

  const load = useCallback(() => {
    if (!agent?.id) return
    db.agentRuns(agent.id).then(setRuns).catch(() => {})
  }, [agent?.id])
  useEffect(() => { load() }, [load])

  // poll so a run created in the industry portal appears without a refresh
  useEffect(() => {
    if (!agent?.id) return
    const t = setInterval(load, 4000)
    return () => clearInterval(t)
  }, [agent?.id, load])

  if (agent === undefined) return <Page title="Overview"><Card>Loading…</Card></Page>
  if (!agent) return <Page title="Overview"><NeedsAgent /></Page>

  const offered = runs.filter((r) => r.status === 'proposed')
  const active = runs.filter((r) => ['accepted', 'in_progress'].includes(r.status))
  const done = runs.filter((r) => r.status === 'delivered')
  const kmSaved = done.reduce((s, r) => s + (Number(r.solo_distance_km) - Number(r.distance_km)), 0)

  return (
    <Page
      title={`Agent ${agent.agent_code}`}
      sub={`${agent.service_area_name} · ${agent.vehicle?.make_model} · ${agent.vehicle?.reg_plate}`}
      right={
        <>
          <Chip tone={agent.status === 'available' ? 'ok' : agent.status === 'on_run' ? 'warn' : 'mute'}>
            {agent.status.replace('_', ' ').toUpperCase()}
          </Chip>
          <button className="btn ghost sm" onClick={async () => {
            const next = agent.status === 'offline' ? 'available' : 'offline'
            await db.setAgentStatus(agent.id, next)
            await reload()
            toast('Status', next === 'available' ? 'You are on duty.' : 'You are off duty.')
          }}>
            {agent.status === 'offline' ? 'Go on duty' : 'Go off duty'}
          </button>
        </>
      }
    >
      {offered.length > 0 && (
        <Banner tone="warn" label="OFFERED">
          <b>{offered.length} bulk pickup{offered.length > 1 ? 's' : ''} waiting for you.</b>{' '}
          Each one is several stops in your area collected in a single trip.
          <div style={{ marginTop: 10 }}>
            <Link className="btn sm" to="/d/runs">Review them</Link>
          </div>
        </Banner>
      )}

      <div className="grid g4">
        <Stat value={offered.length} label="OFFERED" tone="am" />
        <Stat value={active.length} label="ACTIVE" />
        <Stat value={done.length} label="COMPLETED" tone="em" />
        <Stat value={km(kmSaved)} label="DISTANCE AVOIDED" tone="em" />
      </div>

      <div className="grid g2">
        <Card title="Your patch" hint="Everything offered to you sits inside this circle.">
          <MapPlot
            points={[
              { lat: agent.lat, lng: agent.lng, label: agent.agent_code, kind: 'org' },
              ...runs.filter((r) => r.status !== 'delivered')
                .flatMap((r) => r.stops.map((s) => ({
                  lat: s.pickup?.lat, lng: s.pickup?.lng, label: s.pickup?.item_label,
                }))).filter((p) => p.lat),
            ]}
            rings={[{ lat: agent.lat, lng: agent.lng, radius_km: Number(agent.radius_km) }]}
            caption="SERVICE AREA"
          />
        </Card>

        <Card title="Vehicle" hint="Vans only — that is the platform rule.">
          <KV k="AGENT CODE"><span style={{ color: 'var(--em2)' }}>{agent.agent_code}</span></KV>
          <KV k="TYPE">{agent.vehicle?.vehicle_type?.toUpperCase()}</KV>
          <KV k="MODEL">{agent.vehicle?.make_model}</KV>
          <KV k="PLATE">{agent.vehicle?.reg_plate}</KV>
          <KV k="CAPACITY">{kg(agent.vehicle?.capacity_kg)}</KV>
          <KV k="INSURANCE">{agent.vehicle?.insurance_expiry || '—'}</KV>
          <KV k="SERVICE RADIUS">{agent.radius_km} km</KV>
        </Card>
      </div>
    </Page>
  )
}

export function DeliveryRuns() {
  const { agent } = useAgent()
  const [runs, setRuns] = useState([])
  const toast = useToast()

  const load = useCallback(() => {
    if (!agent?.id) return
    db.agentRuns(agent.id).then(setRuns).catch(() => {})
  }, [agent?.id])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (!agent?.id) return
    const t = setInterval(load, 4000)
    return () => clearInterval(t)
  }, [agent?.id, load])

  if (agent === undefined) return <Page title="My runs"><Card>Loading…</Card></Page>
  if (!agent) return <Page title="My runs"><NeedsAgent /></Page>

  return (
    <Page title="My runs" sub="Batched pickups, never single trips.">
      {runs.length === 0 ? (
        <Card>
          <Empty title="Nothing offered yet">
            Runs appear when enough pickups near you are heading to the same industry.
          </Empty>
        </Card>
      ) : (
        runs.map((r) => (
          <Card key={r.id}
            title={`Run ${r.id.slice(0, 6).toUpperCase()} → ${r.industry?.name ?? ''}`}
            hint={`${r.stops.length} stops · ${kg(r.weight_kg)} · ${km(r.distance_km)} · ${ago(r.created_at)}`}
            right={
              <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <Chip tone={RUN_STATUS[r.status]?.tone}>{RUN_STATUS[r.status]?.label}</Chip>
                <Link className="btn ghost sm" to={`/d/runs/${r.id}`}>Open</Link>
              </span>
            }>
            <div className="grid g4" style={{ marginBottom: 4 }}>
              <Stat value={r.stops.length} label="STOPS" />
              <Stat value={kg(r.weight_kg)} label="LOAD" />
              <Stat value={km(r.distance_km)} label="ROUTE" />
              <Stat value={`${r.saved_pct}%`} label="SHORTER THAN SOLO TRIPS" tone="em" />
            </div>
            {r.status === 'proposed' && (
              <div style={{ marginTop: 14, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <button className="btn" onClick={async () => {
                  await db.acceptRun(r.id); load(); toast('Accepted', 'The run is yours.')
                }}>Accept run</button>
                <span style={{ color: 'var(--muted)', fontSize: 12.5 }}>
                  Triggered by: {TRIGGER_LABEL[r.trigger_reason] ?? r.trigger_reason}
                </span>
              </div>
            )}
          </Card>
        ))
      )}
    </Page>
  )
}

export function DeliveryRunDetail() {
  const { id } = useParams()
  const { agent } = useAgent()
  const [run, setRun] = useState(null)
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const nav = useNavigate()

  const load = useCallback(() => {
    if (!agent?.id) return
    db.agentRuns(agent.id).then((rs) => setRun(rs.find((r) => r.id === id) ?? null)).catch(() => {})
  }, [agent?.id, id])
  useEffect(() => { load() }, [load])

  if (agent === undefined || run === null) {
    return <Page title="Run"><Card>Loading…</Card></Page>
  }
  if (!run) return <Page title="Run"><Card><Empty title="Run not found" /></Card></Page>

  const allPicked = run.stops.every((s) => s.picked_at)
  const route = [
    { lat: agent.lat, lng: agent.lng },
    ...run.stops.map((s) => ({ lat: s.pickup?.lat, lng: s.pickup?.lng })).filter((p) => p.lat),
    { lat: run.industry?.lat, lng: run.industry?.lng },
  ]

  return (
    <Page
      title={`Run ${run.id.slice(0, 6).toUpperCase()}`}
      sub={`${run.stops.length} stops → ${run.industry?.name}`}
      right={<Chip tone={RUN_STATUS[run.status]?.tone}>{RUN_STATUS[run.status]?.label}</Chip>}
    >
      <div className="grid g4">
        <Stat value={kg(run.weight_kg)} label="TOTAL LOAD" />
        <Stat value={km(run.distance_km)} label="ROUTE LENGTH" />
        <Stat value={km(run.solo_distance_km)} label="IF DONE SEPARATELY" />
        <Stat value={`${run.saved_pct}%`} label="DISTANCE AVOIDED" tone="em" />
      </div>

      <div className="grid g2">
        <Card title="Route" hint="Ordered nearest-first, then improved with 2-opt.">
          <MapPlot
            points={[
              { lat: agent.lat, lng: agent.lng, label: 'You', kind: 'stop' },
              ...run.stops.map((s, i) => ({
                lat: s.pickup?.lat, lng: s.pickup?.lng, label: String(i + 1),
              })).filter((p) => p.lat),
              { lat: run.industry?.lat, lng: run.industry?.lng, label: run.industry?.name, kind: 'org' },
            ]}
            route={route}
            caption="BASE → STOPS → INDUSTRY"
            height={430}
          />
        </Card>

        <Card title="Stops" hint="Tick each one as you load it.">
          {run.stops.map((s) => (
            <div key={s.pickup_id} style={{
              display: 'flex', gap: 12, alignItems: 'center', padding: '11px 0',
              borderBottom: '1px solid rgba(59,224,127,.08)',
            }}>
              <span className="num" style={{ color: 'var(--muted)', width: 22 }}>
                {String(s.seq).padStart(2, '0')}
              </span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13.5 }}>{s.pickup?.item_label}</div>
                <div style={{ color: 'var(--muted)', fontSize: 12 }}>
                  {s.pickup?.address} · {wasteLabel(s.pickup?.waste_type)} · {kg(s.pickup?.est_weight_kg)}
                </div>
              </div>
              {s.picked_at ? (
                <Chip tone="ok">LOADED</Chip>
              ) : run.status === 'in_progress' ? (
                <button className="btn ghost sm" onClick={async () => {
                  await db.markStopPicked(run.id, s.pickup_id); load()
                }}>Mark loaded</button>
              ) : (
                <Chip tone="mute">PENDING</Chip>
              )}
            </div>
          ))}

          <div style={{ marginTop: 18, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {run.status === 'proposed' && (
              <button className="btn" disabled={busy} onClick={async () => {
                setBusy(true); await db.acceptRun(run.id); await load(); setBusy(false)
                toast('Accepted', 'Start when you are ready to drive.')
              }}>Accept run</button>
            )}
            {run.status === 'accepted' && (
              <button className="btn" disabled={busy} onClick={async () => {
                setBusy(true); await db.startRun(run.id); await load(); setBusy(false)
                toast('Started', 'Collect the stops in order.')
              }}>Start collecting</button>
            )}
            {run.status === 'in_progress' && (
              <button className="btn" disabled={busy || !allPicked} onClick={async () => {
                setBusy(true)
                try {
                  await db.deliverRun(run.id, run.qr_token)
                } catch (err) {
                  toast('Drop refused', err.message, 'am')
                }
                await load()
                setBusy(false)
                toast('Delivered', 'Hub notified, donors credited.', '')
              }}>
                {allPicked ? 'Confirm drop at industry' : 'Load every stop first'}
              </button>
            )}
            {run.status === 'delivered' && (
              <Banner tone="ok" label="CLOSED">
                Dropped at {run.industry?.name}. The hub was notified and every donor on this run has
                been credited.
              </Banner>
            )}
            <button className="btn ghost" onClick={() => nav('/d/runs')}>Back to runs</button>
          </div>

          {run.status === 'in_progress' && (
            <div style={{ marginTop: 16 }}>
              <Banner label="HANDOVER CODE">
                Show <b style={{ color: 'var(--em2)', fontFamily: 'var(--mono)' }}>{run.qr_token}</b> at
                the gate. In production this is the QR the industry scans to sign the transaction.
              </Banner>
            </div>
          )}
        </Card>
      </div>
    </Page>
  )
}

const AREAS = [
  { label: 'Hitec City', lat: 17.4470, lng: 78.3800 },
  { label: 'Kondapur', lat: 17.4640, lng: 78.3650 },
  { label: 'Gachibowli', lat: 17.4180, lng: 78.3400 },
  { label: 'Uppal', lat: 17.4012, lng: 78.5583 },
  { label: 'Secunderabad', lat: 17.4399, lng: 78.4983 },
]

export function DeliveryProfile() {
  const { user } = useAuth()
  const { agent, reload } = useAgent()
  const toast = useToast()

  const [step, setStep] = useState(0)
  const [err, setErr] = useState({})
  const [busy, setBusy] = useState(false)
  const geo = useGeolocation()
  const [f, setF] = useState({
    service_area_name: 'Hitec City',
    lat: AREAS[0].lat, lng: AREAS[0].lng, radius_km: 12,
    phone: '', licence_no: '',
    make_model: '', reg_plate: '', capacity_kg: 600, insurance_expiry: '',
  })

  useEffect(() => {
    if (agent === null) setF((v) => ({ ...v, phone: user.phone || '' }))
  }, [agent, user])

  useEffect(() => {
    if (geo.coords) setF((v) => ({ ...v, lat: geo.coords.lat, lng: geo.coords.lng }))
  }, [geo.coords])

  const set = (k) => (e) => {
    setF((v) => ({ ...v, [k]: e.target?.value ?? e }))
    setErr((v) => ({ ...v, [k]: null }))
  }
  const E = ({ k }) =>
    err[k] ? <div style={{ color: 'var(--red)', fontSize: 11.5, marginTop: 6 }}>{err[k]}</div> : null

  function validate(n) {
    const e = {}
    if (n === 0) {
      if (!f.service_area_name.trim()) e.service_area_name = 'Name the area you cover.'
      if (!(Number(f.radius_km) >= 2)) e.radius_km = 'At least 2 km.'
      if (!/^[\d+\s-]{8,}$/.test(f.phone)) e.phone = 'A reachable phone number is required.'
      if (!f.licence_no.trim()) e.licence_no = 'Required — industries check this at the gate.'
    }
    if (n === 1) {
      if (!f.make_model.trim()) e.make_model = 'Required.'
      if (!f.reg_plate.trim()) e.reg_plate = 'Required.'
      if (!(Number(f.capacity_kg) >= 50)) e.capacity_kg = 'A van should carry at least 50 kg.'
    }
    setErr(e)
    return Object.keys(e).length === 0
  }

  if (agent === undefined) return <Page title="Agent & vehicle"><Card>Loading…</Card></Page>

  /* ---------- already registered ---------- */
  if (agent) {
    return (
      <Page title="Agent & vehicle" sub="Your code, your patch, your van."
        right={<Chip tone="ok">{agent.agent_code}</Chip>}>
        <Banner tone="ok" label="REGISTERED">
          Carry your agent code — <b style={{ fontFamily: 'var(--mono)', color: 'var(--em2)' }}>
          {agent.agent_code}</b> — on every pickup. Industries check it at the gate before accepting a load.
        </Banner>
        <div className="grid g2">
          <Card title="Service area">
            <MapPlot
              points={[{ lat: agent.lat, lng: agent.lng, label: agent.service_area_name, kind: 'org' }]}
              rings={[{ lat: agent.lat, lng: agent.lng, radius_km: Number(agent.radius_km) }]}
              caption="YOU ONLY GET RUNS INSIDE THIS CIRCLE"
            />
            <div style={{ marginTop: 14 }}>
              <KV k="AREA">{agent.service_area_name}</KV>
              <KV k="RADIUS">{agent.radius_km} km</KV>
              <KV k="PHONE">{agent.phone || '—'}</KV>
              <KV k="LICENCE">{agent.licence_no || '—'}</KV>
              <KV k="STATUS">{agent.status.replace('_', ' ')}</KV>
              <KV k="REGISTERED">{ago(agent.created_at)}</KV>
            </div>
          </Card>
          <Card title="Vehicle" hint="A van is mandatory on this platform.">
            <KV k="TYPE">{agent.vehicle?.vehicle_type?.toUpperCase()}</KV>
            <KV k="MODEL">{agent.vehicle?.make_model}</KV>
            <KV k="NUMBER PLATE">{agent.vehicle?.reg_plate}</KV>
            <KV k="CAPACITY">{kg(agent.vehicle?.capacity_kg)}</KV>
            <KV k="INSURANCE EXPIRY">{agent.vehicle?.insurance_expiry || '—'}</KV>
            <div style={{ color: 'var(--muted)', fontSize: 12.5, lineHeight: 1.7, marginTop: 14 }}>
              Capacity is used by the batching engine: a run is only offered to you if its total load
              fits in this van.
            </div>
          </Card>
        </div>
      </Page>
    )
  }

  /* ---------- registration ---------- */
  async function submit() {
    if (!validate(0) || !validate(1)) { setStep(0); return }
    setBusy(true)
    try {
      const a = await db.createAgent(user.id, {
        service_area_name: f.service_area_name.trim(),
        lat: f.lat, lng: f.lng, radius_km: Number(f.radius_km),
        phone: f.phone, licence_no: f.licence_no.trim(),
        vehicle: {
          make_model: f.make_model.trim(),
          reg_plate: f.reg_plate.trim().toUpperCase(),
          capacity_kg: Number(f.capacity_kg),
          insurance_expiry: f.insurance_expiry,
        },
      })
      await reload()
      toast('Registered', `Your agent code is ${a.agent_code}.`)
    } catch (e) {
      toast('Could not register', e.message, 'am')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Page title="Register as a delivery agent" sub="Area, vehicle, and the code you will carry.">
      <div className="steps">
        {['YOUR PATCH', 'YOUR VAN', 'REVIEW'].map((t, i) => (
          <div key={t} className={i === step ? 'on' : i < step ? 'done' : ''}
            onClick={() => i < step && setStep(i)}
            style={{ cursor: i < step ? 'pointer' : 'default' }}>
            {String(i + 1).padStart(2, '0')} {t}
          </div>
        ))}
      </div>

      {step === 0 && (
        <div className="grid g2">
          <Card title="Where you work" hint="You are only offered runs whose stops fall inside this circle.">
            <Field label="AREA NAME">
              <input type="text" value={f.service_area_name} onChange={set('service_area_name')} />
              <E k="service_area_name" />
            </Field>
            <Field label="HOW FAR WILL YOU DRIVE? (KM)">
              <input type="number" min="2" max="40" value={f.radius_km} onChange={set('radius_km')} />
              <E k="radius_km" />
            </Field>
            <div className="row2">
              <Field label="PHONE">
                <input type="text" value={f.phone} onChange={set('phone')} placeholder="+91 …" />
                <E k="phone" />
              </Field>
              <Field label="DRIVING LICENCE NUMBER">
                <input type="text" value={f.licence_no} onChange={set('licence_no')}
                  placeholder="TS0120210012345" />
                <E k="licence_no" />
              </Field>
            </div>
            <button className="btn" onClick={() => validate(0) && setStep(1)}>Continue →</button>
          </Card>

          <Card title="Centre of your patch" hint="Click the map or pick a landmark.">
            <LocationPicker
              value={{ lat: f.lat, lng: f.lng }}
              onChange={(p) => {
                setF((v) => ({ ...v, ...p }))
                const near = AREAS.map((l) => ({ l, d: Math.hypot(l.lat - p.lat, l.lng - p.lng) }))
                  .sort((a, b) => a.d - b.d)[0]
                if (near.d < 0.02) setF((v) => ({ ...v, service_area_name: near.l.label }))
              }}
              landmarks={AREAS}
              rings={[{ lat: f.lat, lng: f.lng, radius_km: Number(f.radius_km) || 1 }]}
              caption="THE DASHED RING IS YOUR RANGE"
              locating={geo.status === 'locating'}
              onUseMyLocation={() => geo.locate()}
            />
          </Card>
        </div>
      )}

      {step === 1 && (
        <div className="grid g2">
          <Card title="Your van" hint="Capacity decides which runs you are offered.">
            <Field label="VEHICLE TYPE">
              <input type="text" value="Van (required by the platform)" disabled />
            </Field>
            <div className="row2">
              <Field label="MAKE & MODEL">
                <input type="text" value={f.make_model} onChange={set('make_model')}
                  placeholder="Tata Ace Gold" />
                <E k="make_model" />
              </Field>
              <Field label="NUMBER PLATE">
                <input type="text" value={f.reg_plate} onChange={set('reg_plate')}
                  placeholder="TS 09 UB 4412" />
                <E k="reg_plate" />
              </Field>
            </div>
            <div className="row2">
              <Field label="LOAD CAPACITY (KG)" hint="A run heavier than this is never offered to you.">
                <input type="number" min="50" value={f.capacity_kg} onChange={set('capacity_kg')} />
                <E k="capacity_kg" />
              </Field>
              <Field label="INSURANCE EXPIRY">
                <input type="text" value={f.insurance_expiry} onChange={set('insurance_expiry')}
                  placeholder="2027-03-14" />
              </Field>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn ghost" onClick={() => setStep(0)}>← Back</button>
              <button className="btn" onClick={() => validate(1) && setStep(2)}>Review →</button>
            </div>
          </Card>

          <Card title="What happens next" hint="How work reaches you.">
            <div className="pipe">
              <div><em>01</em> You are issued an agent code such as ECO-DA-HYD-4821. Carry it on every job.</div>
              <div><em>02</em> Donor pickups near you are matched to industries that want that material.</div>
              <div><em>03</em> Those pickups wait until they add up — by weight, by stop count, or by age.</div>
              <div><em>04</em> The batch is offered to the nearest on-duty van that can carry the load.</div>
              <div><em>05</em> You collect the stops in an optimised order and drop the lot at one industry.</div>
              <div><em>06</em> The hub is notified on delivery and every donor on the run is credited.</div>
            </div>
          </Card>
        </div>
      )}

      {step === 2 && (
        <div className="grid g2">
          <Card title="Check before you submit">
            <KV k="AREA">{f.service_area_name}</KV>
            <KV k="RANGE">{f.radius_km} km</KV>
            <KV k="CENTRE">{Number(f.lat).toFixed(4)}, {Number(f.lng).toFixed(4)}</KV>
            <KV k="PHONE">{f.phone}</KV>
            <KV k="LICENCE">{f.licence_no}</KV>
            <KV k="VAN">{f.make_model} · {f.reg_plate.toUpperCase()}</KV>
            <KV k="CAPACITY">{kg(f.capacity_kg)}</KV>
            <KV k="INSURANCE">{f.insurance_expiry || '—'}</KV>
            <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
              <button className="btn ghost" onClick={() => setStep(1)}>← Back</button>
              <button className="btn" onClick={submit} disabled={busy}>
                {busy ? 'Registering…' : 'Register and get my code'}
              </button>
            </div>
          </Card>
          <Card title="Your patch">
            <MapPlot
              points={[{ lat: f.lat, lng: f.lng, label: f.service_area_name, kind: 'org' }]}
              rings={[{ lat: f.lat, lng: f.lng, radius_km: Number(f.radius_km) }]}
              caption="SERVICE AREA"
            />
          </Card>
        </div>
      )}
    </Page>
  )
}
