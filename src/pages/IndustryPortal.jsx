import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Page } from '../components/Shell.jsx'
import MapPlot from '../components/MapPlot.jsx'
import LocationPicker from '../components/LocationPicker.jsx'
import { useGeolocation } from '../hooks/useGeolocation.js'
import {
  Banner, Card, Chip, Empty, Field, KV, Stat, Toggle, useToast, ago, kg, km,
} from '../components/ui.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { db } from '../lib/db.js'
import { BATCH_RULES } from '../lib/batching.js'
import { PICKUP_STATUS, RUN_STATUS, TRIGGER_LABEL, WASTE_TYPES, wasteLabel } from '../lib/waste.js'

/** Loads the signed-in owner's industry once and shares it. */
function useIndustry() {
  const { user } = useAuth()
  const [industry, setIndustry] = useState(undefined) // undefined = loading, null = none yet
  const reload = useCallback(
    () => db.getMyIndustry(user.id).then(setIndustry).catch(() => setIndustry(null)),
    [user.id]
  )
  useEffect(() => { reload() }, [reload])
  return { industry, setIndustry, reload }
}

function NeedsRegistration() {
  return (
    <Card>
      <Empty title="Your organisation is not registered yet">
        Add your registration details, the waste you process and the areas you serve.
        <div style={{ marginTop: 18 }}>
          <Link className="btn" to="/i/profile">Register the organisation</Link>
        </div>
      </Empty>
    </Card>
  )
}

function VerificationBanner({ industry }) {
  if (industry.verification_status === 'verified') return null
  if (industry.verification_status === 'rejected') {
    return (
      <Banner tone="bad" label="REJECTED">
        {industry.verification_note || 'The registration details could not be confirmed.'}
      </Banner>
    )
  }
  return (
    <Banner tone="warn" label="PENDING">
      <b>Verification is pending.</b> Unverified organisations are not shown to donors and receive
      no matches — this is what stops anyone claiming to be a recycler. A reviewer approves it from
      the verification desk; you cannot approve your own registration.
    </Banner>
  )
}

export function IndustryHome() {
  const { industry, reload } = useIndustry()
  const [pickups, setPickups] = useState([])
  const [runs, setRuns] = useState([])
  const toast = useToast()

  useEffect(() => {
    if (!industry?.id) return
    db.industryPickups(industry.id).then(setPickups).catch(() => {})
    db.industryRuns(industry.id).then(setRuns).catch(() => {})
  }, [industry?.id])

  if (industry === undefined) return <Page title="Overview"><Card>Loading…</Card></Page>
  if (!industry) return <Page title="Overview"><NeedsRegistration /></Page>

  const waiting = pickups.filter((p) => p.status === 'matched')
  const inRun = pickups.filter((p) => ['batched', 'picked'].includes(p.status))
  const done = pickups.filter((p) => p.status === 'delivered')
  const received = done.reduce((s, p) => s + Number(p.est_weight_kg || 0), 0)

  return (
    <Page title={industry.name} sub={industry.address}
      right={<Chip tone={industry.verification_status === 'verified' ? 'ok' : 'warn'}>
        {industry.verification_status.toUpperCase()}
      </Chip>}>
      <VerificationBanner industry={industry} />

      <div className="grid g4">
        <Stat value={waiting.length} label="WAITING TO BATCH" tone="am" />
        <Stat value={inRun.length} label="IN A VAN RUN" />
        <Stat value={done.length} label="RECEIVED" tone="em" />
        <Stat value={kg(received)} label="TOTAL WEIGHT IN" />
      </div>

      <div className="grid g2">
        <Card title="Your catchment" hint="Enrolled areas and the scrap matched inside them.">
          <MapPlot
            points={[
              { lat: industry.lat, lng: industry.lng, label: industry.name, kind: 'org' },
              ...pickups.filter((p) => p.status !== 'delivered')
                .map((p) => ({ lat: p.lat, lng: p.lng, label: p.item_label })),
            ]}
            rings={industry.areas}
            caption="DASHED RINGS ARE ENROLLED AREAS"
          />
        </Card>

        <Card title="What you accept" hint="Only these streams are routed to you."
          right={<Link className="btn ghost sm" to="/i/profile">Edit</Link>}>
          <div className="checks" style={{ marginBottom: 20 }}>
            {industry.waste_types.length === 0
              ? <span style={{ color: 'var(--muted)', fontSize: 13 }}>Nothing selected yet.</span>
              : industry.waste_types.map((w) => <Chip key={w} tone="ok" dot={false}>{wasteLabel(w)}</Chip>)}
          </div>
          <KV k="AREAS ENROLLED">{industry.areas.length}</KV>
          <KV k="REG NUMBER">{industry.reg_number}</KV>
          <KV k="CONTACT">{industry.contact_email || '—'}</KV>
        </Card>
      </div>

      <Card title="Latest deliveries" right={<Link className="btn ghost sm" to="/i/runs">All deliveries</Link>}>
        {runs.length === 0
          ? <Empty title="No runs yet">Scrap is batched into a van run once there is enough of it nearby.</Empty>
          : (
            <div className="tablewrap">
              <table>
                <thead><tr><th>RUN</th><th>STOPS</th><th>WEIGHT</th><th>AGENT</th><th>STATUS</th><th>WHEN</th></tr></thead>
                <tbody>
                  {runs.slice(0, 6).map((r) => (
                    <tr key={r.id}>
                      <td className="num">{r.id.slice(0, 6).toUpperCase()}</td>
                      <td className="num">{r.stops.length}</td>
                      <td className="num">{kg(r.weight_kg)}</td>
                      <td className="num">{r.agent?.agent_code ?? '—'}</td>
                      <td><Chip tone={RUN_STATUS[r.status]?.tone}>{RUN_STATUS[r.status]?.label}</Chip></td>
                      <td className="num" style={{ color: 'var(--muted)' }}>{ago(r.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </Card>
    </Page>
  )
}

export function IndustryQueue() {
  const { industry } = useIndustry()
  const [pickups, setPickups] = useState([])
  const [waiting, setWaiting] = useState(null)
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  const load = useCallback(() => {
    if (!industry?.id) return
    db.industryPickups(industry.id).then(setPickups).catch(() => {})
  }, [industry?.id])
  useEffect(() => { load() }, [load])

  if (industry === undefined) return <Page title="Incoming scrap"><Card>Loading…</Card></Page>
  if (!industry) return <Page title="Incoming scrap"><NeedsRegistration /></Page>

  const queue = pickups.filter((p) => p.status === 'matched')
  const queueKg = queue.reduce((s, p) => s + Number(p.est_weight_kg || 0), 0)

  async function batch() {
    setBusy(true)
    try {
      const { created, waiting } = await db.runBatching()
      setWaiting(waiting.filter((w) => w.industry_id === industry.id))
      const mine = created.filter((r) => r.industry_id === industry.id)
      toast(
        mine.length ? 'Runs created' : 'Nothing dispatched',
        mine.length
          ? `${mine.length} van run${mine.length > 1 ? 's' : ''} offered to agents.`
          : 'No cluster met the threshold yet.',
        mine.length ? '' : 'am'
      )
      load()
    } catch (e) {
      toast('Batching failed', e.message, 'am')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Page title="Incoming scrap" sub="Matched to you, waiting to be batched into a van run."
      right={<button className="btn" onClick={batch} disabled={busy || queue.length === 0}>
        {busy ? 'Planning…' : 'Run batching now'}
      </button>}>

      <Banner label="HOW IT WORKS">
        A pickup is never collected on its own. Items waiting near each other and bound for you are
        grouped, and a run leaves once it carries <b>{BATCH_RULES.MIN_BULK_KG} kg</b>, or has{' '}
        <b>{BATCH_RULES.MIN_STOPS} stops</b>, or the oldest item has waited{' '}
        <b>{BATCH_RULES.MAX_WAIT_HOURS} hours</b> — whichever comes first. Clustering radius is{' '}
        {BATCH_RULES.CLUSTER_RADIUS_KM} km, ceiling {BATCH_RULES.MAX_STOPS} stops.
      </Banner>

      <div className="grid g4">
        <Stat value={queue.length} label="ITEMS WAITING" tone="am" />
        <Stat value={kg(queueKg)} label="WEIGHT WAITING" />
        <Stat value={BATCH_RULES.MIN_BULK_KG} label="KG TO TRIGGER" />
        <Stat value={BATCH_RULES.MAX_WAIT_HOURS + 'h'} label="MAX WAIT" />
      </div>

      {waiting?.length > 0 && (
        <Card title="Why some items are still waiting" hint="Straight from the batching pass.">
          {waiting.map((w, i) => (
            <div key={i} style={{ padding: '10px 0', borderBottom: '1px solid rgba(59,224,127,.08)' }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <Chip tone="warn">{w.reason === 'below_threshold' ? 'BELOW THRESHOLD' : 'NO VAN AVAILABLE'}</Chip>
                <span style={{ fontSize: 13 }}>
                  {w.pickups.length} item{w.pickups.length > 1 ? 's' : ''} · {kg(w.weight_kg)}
                </span>
                {w.reason === 'below_threshold' && (
                  <span style={{ color: 'var(--muted)', fontSize: 12.5 }}>
                    needs {kg(w.needs_kg)} more, or {w.needs_stops} more stop{w.needs_stops === 1 ? '' : 's'}
                  </span>
                )}
              </div>
            </div>
          ))}
        </Card>
      )}

      <Card title="Queue">
        {queue.length === 0
          ? <Empty title="Queue is empty">Everything matched to you is already in a run or delivered.</Empty>
          : (
            <div className="tablewrap">
              <table>
                <thead><tr><th>ITEM</th><th>TYPE</th><th>CONDITION</th><th>WEIGHT</th><th>FROM</th><th>WAITING</th></tr></thead>
                <tbody>
                  {queue.map((p) => (
                    <tr key={p.id}>
                      <td>{p.item_label}</td>
                      <td><Chip dot={false}>{wasteLabel(p.waste_type)}</Chip></td>
                      <td className="num">{p.condition ?? '—'}</td>
                      <td className="num">{kg(p.est_weight_kg)}</td>
                      <td style={{ color: 'var(--muted)' }}>{p.address}</td>
                      <td className="num" style={{ color: 'var(--muted)' }}>{ago(p.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </Card>

      <Card title="All matched items" hint="Including those already collected.">
        <div className="tablewrap">
          <table>
            <thead><tr><th>ITEM</th><th>WEIGHT</th><th>STATUS</th><th>WHEN</th></tr></thead>
            <tbody>
              {pickups.map((p) => (
                <tr key={p.id}>
                  <td>{p.item_label}</td>
                  <td className="num">{kg(p.est_weight_kg)}</td>
                  <td><Chip tone={PICKUP_STATUS[p.status]?.tone}>{PICKUP_STATUS[p.status]?.label}</Chip></td>
                  <td className="num" style={{ color: 'var(--muted)' }}>{ago(p.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </Page>
  )
}

export function IndustryRuns() {
  const { industry } = useIndustry()
  const [runs, setRuns] = useState([])

  useEffect(() => {
    if (!industry?.id) return
    db.industryRuns(industry.id).then(setRuns).catch(() => {})
  }, [industry?.id])

  if (industry === undefined) return <Page title="Deliveries"><Card>Loading…</Card></Page>
  if (!industry) return <Page title="Deliveries"><NeedsRegistration /></Page>

  return (
    <Page title="Deliveries" sub="Van runs bringing scrap to your gate.">
      {runs.length === 0 ? (
        <Card><Empty title="No runs yet">Batched pickups will show up here with their agent and ETA.</Empty></Card>
      ) : (
        runs.map((r) => (
          <Card key={r.id}
            title={`Run ${r.id.slice(0, 6).toUpperCase()}`}
            hint={`${r.stops.length} stops · ${kg(r.weight_kg)} · ${km(r.distance_km)}`}
            right={<Chip tone={RUN_STATUS[r.status]?.tone}>{RUN_STATUS[r.status]?.label}</Chip>}>
            <div className="grid g2">
              <div>
                <KV k="AGENT">{r.agent?.agent_code ?? '—'}</KV>
                <KV k="SERVICE AREA">{r.agent?.service_area_name ?? '—'}</KV>
                <KV k="TRIGGER">{TRIGGER_LABEL[r.trigger_reason] ?? r.trigger_reason}</KV>
                <KV k="DISTANCE SAVED"><span style={{ color: 'var(--em2)' }}>{r.saved_pct}%</span></KV>
                <KV k="CREATED">{ago(r.created_at)}</KV>
              </div>
              <div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 9.5, letterSpacing: '.18em',
                  color: 'var(--muted)', marginBottom: 10 }}>STOPS</div>
                {r.stops.map((s) => (
                  <div key={s.pickup_id} className="kv">
                    <span>{String(s.seq).padStart(2, '0')}</span>
                    <b style={{ fontWeight: 400, fontSize: 12.5 }}>
                      {s.pickup?.item_label} — {kg(s.pickup?.est_weight_kg)}
                    </b>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        ))
      )}
    </Page>
  )
}

/* ============================================================
   Registration — a five-step wizard.
   Nobody knows their own latitude, so location is a map pin. Nothing
   is asked twice, each step validates on its own, and the review step
   shows exactly what a verifier will see.
   ============================================================ */

const LANDMARKS = [
  { label: 'Hitec City', lat: 17.4485, lng: 78.3908 },
  { label: 'Kondapur', lat: 17.4615, lng: 78.3620 },
  { label: 'Gachibowli', lat: 17.4180, lng: 78.3400 },
  { label: 'Uppal / IDA', lat: 17.4012, lng: 78.5583 },
  { label: 'Secunderabad', lat: 17.4399, lng: 78.4983 },
  { label: 'Balanagar', lat: 17.4720, lng: 78.4400 },
]

const ORG_TYPES = [
  { id: 'ngo', label: 'NGO / charity', note: 'Redistributes usable goods' },
  { id: 'recycler', label: 'Recycler', note: 'Processes material back into feedstock' },
  { id: 'processor', label: 'Processor / industry', note: 'Uses recovered material in production' },
  { id: 'dealer', label: 'Scrap dealer', note: 'Aggregates and resells' },
]

const STEPS = ['ORGANISATION', 'LOCATION', 'TARGET TRASH', 'AREAS SERVED', 'REVIEW']

export function IndustryProfile() {
  const { user } = useAuth()
  const { industry, reload } = useIndustry()
  const toast = useToast()

  const [step, setStep] = useState(0)
  const [err, setErr] = useState({})
  const [busy, setBusy] = useState(false)
  const [radius, setRadius] = useState(6)
  const [areaName, setAreaName] = useState(LANDMARKS[0].label)
  const [areaPin, setAreaPin] = useState({ lat: LANDMARKS[0].lat, lng: LANDMARKS[0].lng })
  const geo = useGeolocation()

  const [f, setF] = useState({
    name: '', org_type: 'ngo', reg_number: '', gst_number: '',
    contact_person: '', phone: '', contact_email: '',
    address: '', city: 'Hyderabad', pincode: '',
    lat: null, lng: null,
    waste_types: [], capacity_kg_month: 2000,
    doc_ref: '',
  })

  const registered = Boolean(industry)

  useEffect(() => {
    if (industry) {
      setF((v) => ({
        ...v,
        ...Object.fromEntries(
          Object.entries({
            name: industry.name, org_type: industry.org_type, reg_number: industry.reg_number,
            gst_number: industry.gst_number, contact_person: industry.contact_person,
            phone: industry.phone, contact_email: industry.contact_email,
            address: industry.address, city: industry.city, pincode: industry.pincode,
            lat: industry.lat, lng: industry.lng,
            waste_types: industry.waste_types, capacity_kg_month: industry.capacity_kg_month,
            doc_ref: industry.doc_ref,
          }).filter(([, val]) => val !== undefined && val !== null)
        ),
      }))
    } else if (industry === null) {
      setF((v) => ({ ...v, contact_person: user.full_name, contact_email: user.email,
        phone: user.phone || '' }))
    }
  }, [industry, user])

  const set = (k) => (e) => {
    setF((v) => ({ ...v, [k]: e.target?.value ?? e }))
    setErr((v) => ({ ...v, [k]: null }))
  }

  useEffect(() => {
    if (geo.coords) {
      setF((v) => ({ ...v, lat: geo.coords.lat, lng: geo.coords.lng,
        address: v.address || geo.address }))
      setErr((v) => ({ ...v, lat: null }))
    }
  }, [geo.coords, geo.address])

  function validate(n) {
    const e = {}
    if (n === 0) {
      if (!f.name.trim()) e.name = 'Required.'
      if (!f.reg_number.trim()) e.reg_number = 'Required — this is what a verifier checks.'
      else if (f.reg_number.trim().length < 6) e.reg_number = 'That looks too short to be a real number.'
      if (!f.contact_person.trim()) e.contact_person = 'Required.'
      if (!/^\S+@\S+\.\S+$/.test(f.contact_email)) e.contact_email = 'Enter a valid email.'
      if (f.phone && !/^[\d+\s-]{8,}$/.test(f.phone)) e.phone = 'Digits, spaces, + and - only.'
    }
    if (n === 1) {
      if (!f.address.trim()) e.address = 'Required.'
      if (f.pincode && !/^\d{6}$/.test(f.pincode)) e.pincode = 'Indian pincodes are 6 digits.'
      if (f.lat == null) e.lat = 'Place the pin on the map.'
    }
    if (n === 2) {
      if (!f.waste_types.length) e.waste_types = 'Pick at least one — this drives every match you get.'
      if (!(Number(f.capacity_kg_month) > 0)) e.capacity_kg_month = 'Must be more than zero.'
    }
    setErr(e)
    return Object.keys(e).length === 0
  }

  const go = (n) => {
    if (n > step && !validate(step)) return
    setStep(n)
  }

  async function submit() {
    if (!validate(0) || !validate(1) || !validate(2)) {
      toast('Something is missing', 'Check the earlier steps.', 'am')
      return
    }
    setBusy(true)
    try {
      if (registered) {
        await db.updateIndustry(industry.id, f)
        toast('Saved', 'Registration updated.')
      } else {
        await db.createIndustry(user.id, f)
        toast('Submitted', 'Now enrol the areas you collect from.')
      }
      await reload()
      setStep(3)
    } catch (e) {
      // A server-side clash belongs on the field that caused it, not only in a toast.
      if (/registration number/i.test(e.message)) {
        setErr({ reg_number: e.message })
        setStep(0)
      }
      toast('Could not save', e.message, 'am')
    } finally {
      setBusy(false)
    }
  }

  if (industry === undefined) return <Page title="Registration"><Card>Loading…</Card></Page>

  const E = ({ k }) =>
    err[k] ? <div style={{ color: 'var(--red)', fontSize: 11.5, marginTop: 6 }}>{err[k]}</div> : null

  return (
    <Page
      title={registered ? 'Registration' : 'Register your organisation'}
      sub={registered
        ? 'Everything a verifier sees, and the areas you collect from.'
        : 'Five short steps. You can come back and change any of it.'}
      right={registered && (
        <Chip tone={industry.verification_status === 'verified' ? 'ok' : 'warn'}>
          {industry.verification_status.toUpperCase()}
        </Chip>
      )}
    >
      {registered && (
        <VerificationBanner industry={industry} />
      )}

      <div className="steps">
        {STEPS.map((s, i) => (
          <div
            key={s}
            className={i === step ? 'on' : i < step || registered ? 'done' : ''}
            onClick={() => (registered || i < step) && go(i)}
            style={{ cursor: registered || i < step ? 'pointer' : 'default' }}
          >
            {String(i + 1).padStart(2, '0')} {s}
          </div>
        ))}
      </div>

      {/* ---------- 1. organisation ---------- */}
      {step === 0 && (
        <Card title="Who you are" hint="The registration number is the field a verifier actually checks.">
          <div className="row2">
            <Field label="ORGANISATION NAME">
              <input type="text" value={f.name} onChange={set('name')}
                placeholder="Goonj Collection Hub" />
              <E k="name" />
            </Field>
            <Field label="REGISTRATION NUMBER" hint="Society, trust, MSME or pollution-board number.">
              <input type="text" value={f.reg_number} onChange={set('reg_number')}
                placeholder="TS/NGO/2019/4471" />
              <E k="reg_number" />
            </Field>
          </div>

          <Field label="ORGANISATION TYPE">
            <div className="roles" style={{ gridTemplateColumns: 'repeat(2,1fr)', display: 'grid', gap: 10 }}>
              {ORG_TYPES.map((o) => (
                <button key={o.id} type="button"
                  className={`role ${f.org_type === o.id ? 'on' : ''}`}
                  onClick={() => setF((v) => ({ ...v, org_type: o.id }))}>
                  <h4 style={{ fontSize: 14 }}>{o.label}</h4>
                  <p>{o.note}</p>
                </button>
              ))}
            </div>
          </Field>

          <div className="row2">
            <Field label="GST / CIN (OPTIONAL)">
              <input type="text" value={f.gst_number} onChange={set('gst_number')}
                placeholder="36AABCU9603R1ZM" />
            </Field>
            <Field label="CONTACT PERSON">
              <input type="text" value={f.contact_person} onChange={set('contact_person')} />
              <E k="contact_person" />
            </Field>
          </div>
          <div className="row2">
            <Field label="CONTACT EMAIL">
              <input type="email" value={f.contact_email} onChange={set('contact_email')} />
              <E k="contact_email" />
            </Field>
            <Field label="PHONE">
              <input type="text" value={f.phone} onChange={set('phone')} placeholder="+91 …" />
              <E k="phone" />
            </Field>
          </div>

          <button className="btn" onClick={() => go(1)}>Continue →</button>
        </Card>
      )}

      {/* ---------- 2. location ---------- */}
      {step === 1 && (
        <div className="grid g2">
          <Card title="Where you are" hint="The gate a van will actually drive to.">
            <Field label="STREET ADDRESS">
              <input type="text" value={f.address} onChange={set('address')}
                placeholder="Plot 22, Sector 3" />
              <E k="address" />
            </Field>
            <div className="row2">
              <Field label="CITY">
                <input type="text" value={f.city} onChange={set('city')} />
              </Field>
              <Field label="PINCODE">
                <input type="text" inputMode="numeric" value={f.pincode} onChange={set('pincode')}
                  placeholder="500081" />
                <E k="pincode" />
              </Field>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
              <button className="btn ghost" onClick={() => setStep(0)}>← Back</button>
              <button className="btn" onClick={() => go(2)}>Continue →</button>
            </div>
          </Card>

          <Card title="Drop your pin" hint="Click the map, tap a landmark, or nudge with arrow keys.">
            <LocationPicker
              value={f.lat == null ? null : { lat: f.lat, lng: f.lng }}
              onChange={(p) => { setF((v) => ({ ...v, ...p })); setErr((v) => ({ ...v, lat: null })) }}
              landmarks={LANDMARKS}
              caption="YOUR FACILITY"
              locating={geo.status === 'locating'}
              onUseMyLocation={() => geo.locate()}
            />
            <E k="lat" />
            {geo.error && (
              <div style={{ color: 'var(--amber)', fontSize: 12, marginTop: 8 }}>{geo.error}</div>
            )}
          </Card>
        </div>
      )}

      {/* ---------- 3. target trash ---------- */}
      {step === 2 && (
        <Card title="Target trash" hint="Only these streams are ever routed to you. Everything else goes elsewhere.">
          <Field label="MATERIALS YOU ACTUALLY PROCESS">
            <div className="checks">
              {WASTE_TYPES.map((w) => (
                <Toggle key={w.id} on={f.waste_types.includes(w.id)}
                  onChange={(on) => {
                    setF((v) => ({
                      ...v,
                      waste_types: on
                        ? [...v.waste_types, w.id]
                        : v.waste_types.filter((x) => x !== w.id),
                    }))
                    setErr((v) => ({ ...v, waste_types: null }))
                  }}>
                  {w.label}
                </Toggle>
              ))}
            </div>
            <E k="waste_types" />
          </Field>

          <div style={{ display: 'grid', gap: 10, margin: '4px 0 20px' }}>
            {f.waste_types.map((w) => {
              const t = WASTE_TYPES.find((x) => x.id === w)
              return (
                <div key={w} className="kv">
                  <span>{t.label.toUpperCase()}</span>
                  <b style={{ fontWeight: 400, fontSize: 12.5, color: 'var(--muted)' }}>{t.note}</b>
                </div>
              )
            })}
          </div>

          <Field label="MONTHLY INTAKE CAPACITY (KG)"
            hint="Used for planning. You will not be flooded past this without warning.">
            <input type="number" min="1" value={f.capacity_kg_month} onChange={set('capacity_kg_month')} />
            <E k="capacity_kg_month" />
          </Field>

          <Field label="SUPPORTING DOCUMENT (OPTIONAL)"
            hint="Registration certificate or pollution-board licence. The file name is recorded here; wire the upload to Supabase Storage when you want the file itself.">
            <input type="file" onChange={(e) =>
              setF((v) => ({ ...v, doc_ref: e.target.files?.[0]?.name || '' }))} />
            {f.doc_ref && <div style={{ marginTop: 8 }}><Chip tone="ok" dot={false}>{f.doc_ref}</Chip></div>}
          </Field>

          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn ghost" onClick={() => setStep(1)}>← Back</button>
            <button className="btn" onClick={submit} disabled={busy}>
              {busy ? 'Saving…' : registered ? 'Save changes' : 'Submit for verification'}
            </button>
          </div>
        </Card>
      )}

      {/* ---------- 4. areas ---------- */}
      {step === 3 && (
        registered ? (
          <div className="grid g2">
            <Card title="Areas you collect from" hint="Nothing outside these circles is matched to you.">
              {industry.areas.length === 0 ? (
                <Banner tone="warn" label="EMPTY">
                  No areas enrolled — you will receive nothing until you add one.
                </Banner>
              ) : (
                industry.areas.map((a) => (
                  <div key={a.id} className="kv">
                    <span>{a.area_name.toUpperCase()}</span>
                    <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                      <b>{a.radius_km} km</b>
                      <button className="btn ghost sm" onClick={async () => {
                        await db.removeArea(industry.id, a.id); await reload()
                      }}>Remove</button>
                    </span>
                  </div>
                ))
              )}

              <div className="row2" style={{ marginTop: 20 }}>
                <Field label="AREA NAME">
                  <input type="text" value={areaName} onChange={(e) => setAreaName(e.target.value)} />
                </Field>
                <Field label="RADIUS (KM)">
                  <input type="number" min="1" max="40" value={radius}
                    onChange={(e) => setRadius(Number(e.target.value))} />
                </Field>
              </div>
              <button className="btn" disabled={!areaName.trim()} onClick={async () => {
                await db.addArea(industry.id, { area_name: areaName.trim(), ...areaPin, radius_km: radius })
                await reload()
                toast('Area enrolled', `${areaName}, ${radius} km radius.`)
              }}>Enrol this area</button>
              <div style={{ marginTop: 14 }}>
                <button className="btn ghost" onClick={() => setStep(4)}>Review →</button>
              </div>
            </Card>

            <Card title="Place the area" hint="Click the centre of the neighbourhood you want to cover.">
              <LocationPicker
                value={areaPin}
                onChange={(p) => {
                  setAreaPin(p)
                  const near = LANDMARKS.map((l) => ({ l, d: Math.hypot(l.lat - p.lat, l.lng - p.lng) }))
                    .sort((a, b) => a.d - b.d)[0]
                  if (near.d < 0.02) setAreaName(near.l.label)
                }}
                landmarks={LANDMARKS}
                rings={[
                  ...industry.areas,
                  { ...areaPin, radius_km: radius },
                ]}
                caption="SOLID RINGS ARE ENROLLED · DASHED IS THE NEW ONE"
              />
            </Card>
          </div>
        ) : (
          <Card><Empty title="Submit the registration first">
            Areas can be enrolled once the organisation record exists.
          </Empty></Card>
        )
      )}

      {/* ---------- 5. review ---------- */}
      {step === 4 && (
        <div className="grid g2">
          <Card title="What a verifier sees" hint="Check this reads correctly before approval.">
            <KV k="NAME">{f.name || '—'}</KV>
            <KV k="TYPE">{ORG_TYPES.find((o) => o.id === f.org_type)?.label}</KV>
            <KV k="REG NUMBER">{f.reg_number || '—'}</KV>
            <KV k="GST / CIN">{f.gst_number || '—'}</KV>
            <KV k="CONTACT">{f.contact_person} · {f.contact_email}</KV>
            <KV k="PHONE">{f.phone || '—'}</KV>
            <KV k="ADDRESS">{[f.address, f.city, f.pincode].filter(Boolean).join(', ')}</KV>
            <KV k="COORDINATES">
              {f.lat == null ? '—' : `${Number(f.lat).toFixed(4)}, ${Number(f.lng).toFixed(4)}`}
            </KV>
            <KV k="CAPACITY">{f.capacity_kg_month} kg / month</KV>
            <KV k="DOCUMENT">{f.doc_ref || 'none attached'}</KV>
            <div style={{ marginTop: 16 }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 9.5, letterSpacing: '.18em',
                color: 'var(--muted)', marginBottom: 10 }}>TARGET TRASH</div>
              <div className="checks">
                {f.waste_types.length
                  ? f.waste_types.map((w) => <Chip key={w} tone="ok" dot={false}>{wasteLabel(w)}</Chip>)
                  : <span style={{ color: 'var(--red)', fontSize: 13 }}>None selected</span>}
              </div>
            </div>
            <div style={{ marginTop: 18, display: 'flex', gap: 10 }}>
              <button className="btn ghost" onClick={() => setStep(0)}>Edit details</button>
              <button className="btn" onClick={submit} disabled={busy}>
                {busy ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </Card>

          <Card title="Coverage" hint="Your facility and the areas you have enrolled.">
            <MapPlot
              points={f.lat == null ? [] : [{ lat: f.lat, lng: f.lng, label: f.name, kind: 'org' }]}
              rings={industry?.areas ?? []}
              caption="DASHED RINGS ARE ENROLLED AREAS"
            />
            <div style={{ marginTop: 14 }}>
              <KV k="AREAS ENROLLED">{industry?.areas.length ?? 0}</KV>
              <KV k="STATUS">
                <Chip tone={industry?.verification_status === 'verified' ? 'ok' : 'warn'}>
                  {(industry?.verification_status ?? 'not submitted').toUpperCase()}
                </Chip>
              </KV>
            </div>
            {(industry?.areas.length ?? 0) === 0 && (
              <div style={{ marginTop: 14 }}>
                <Banner tone="warn" label="NO AREAS">
                  You are verified but collecting from nowhere. Add an area in step 4.
                </Banner>
              </div>
            )}
          </Card>
        </div>
      )}
    </Page>
  )
}
