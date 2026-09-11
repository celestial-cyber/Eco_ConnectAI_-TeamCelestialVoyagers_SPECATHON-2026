import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Page } from '../components/Shell.jsx'
import MapPlot from '../components/MapPlot.jsx'
import LocationPicker from '../components/LocationPicker.jsx'
import Camera from '../components/Camera.jsx'
import { useGeolocation, accuracyNote } from '../hooks/useGeolocation.js'
import {
  Banner, Card, Chip, Empty, Field, KV, Stat, Steps, useToast, ago, kg,
} from '../components/ui.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { db, classify, serverInfo } from '../lib/db.js'
import { PICKUP_STATUS, WASTE_TYPES, wasteLabel } from '../lib/waste.js'


export function UserHome() {
  const { user } = useAuth()
  const [rows, setRows] = useState([])
  const nav = useNavigate()

  useEffect(() => {
    db.myPickups(user.id).then(setRows).catch(() => {})
  }, [user.id])

  const delivered = rows.filter((r) => r.status === 'delivered')
  const active = rows.filter((r) => !['delivered', 'cancelled'].includes(r.status))
  const savedKg = delivered.reduce((s, r) => s + Number(r.est_weight_kg || 0), 0)

  return (
    <Page
      title={`Hello, ${user.full_name.split(' ')[0]}`}
      sub="Everything you have sent back into circulation."
      right={<button className="btn" onClick={() => nav('/u/scan')}>Scan an item</button>}
    >
      <div className="grid g4">
        <Stat value={user.eco_points ?? 0} label="ECO POINTS" tone="am" />
        <Stat value={delivered.length} label="ITEMS DIVERTED" tone="em" />
        <Stat value={kg(savedKg)} label="WEIGHT DIVERTED" />
        <Stat value={active.length} label="IN PROGRESS" />
      </div>

      <Card title="Recent activity" hint="Newest first.">
        {rows.length === 0 ? (
          <Empty title="Nothing scanned yet">
            Photograph something you no longer want and we will find it a home.
          </Empty>
        ) : (
          <div className="tablewrap">
            <table>
              <thead>
                <tr><th>ITEM</th><th>TYPE</th><th>WEIGHT</th><th>STATUS</th><th>POINTS</th><th>WHEN</th></tr>
              </thead>
              <tbody>
                {rows.slice(0, 8).map((r) => (
                  <tr key={r.id}>
                    <td>{r.item_label}</td>
                    <td><Chip dot={false}>{wasteLabel(r.waste_type)}</Chip></td>
                    <td className="num">{kg(r.est_weight_kg)}</td>
                    <td><Chip tone={PICKUP_STATUS[r.status]?.tone}>{PICKUP_STATUS[r.status]?.label}</Chip></td>
                    <td className="num" style={{ color: r.points_awarded ? 'var(--amber)' : 'var(--faint)' }}>
                      {r.points_awarded ? `+${r.points_awarded}` : '—'}
                    </td>
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

export function UserScan() {
  const { user, refresh } = useAuth()
  const toast = useToast()
  const nav = useNavigate()
  const fileRef = useRef(null)

  const [step, setStep] = useState(0)        // 0 capture · 1 analysing · 2 confirm · 3 matched
  const [mode, setMode] = useState('choose') // choose | camera
  const [photo, setPhoto] = useState(null)   // the File we will upload
  const [preview, setPreview] = useState(null)
  const [analysis, setAnalysis] = useState(null)
  const [modelErr, setModelErr] = useState('')
  const [unclear, setUnclear] = useState(false)
  const [item, setItem] = useState({ label: '', type: 'textile', condition: 6, weight: 3 })
  const [outcome, setOutcome] = useState(null)
  const [busy, setBusy] = useState(false)
  const [hot, setHot] = useState(false)
  const [vision, setVision] = useState(null)

  const geo = useGeolocation({ auto: true })

  useEffect(() => {
    serverInfo().then((h) => setVision(h.vision)).catch(() => {})
  }, [])

  async function handle(file) {
    if (!file) return
    if (!/^image\//.test(file.type)) {
      toast('Not an image', 'Choose a jpg or png photo.', 'am')
      return
    }
    setPhoto(file)
    setPreview(URL.createObjectURL(file))
    setMode('choose')
    setModelErr('')
    setUnclear(false)
    setAnalysis(null)
    setStep(1)

    try {
      const r = await classify(file)
      setAnalysis(r)
      setUnclear(Boolean(r.unclear))
      setItem({
        label: r.unclear ? '' : r.item_label ?? '',
        type: r.waste_type ?? 'textile',
        condition: r.condition ?? 6,
        weight: r.est_weight_kg ?? 3,
      })
    } catch (e) {
      setModelErr(e.message)
      setItem({ label: '', type: 'textile', condition: 6, weight: 3 })
    } finally {
      setStep(2)
    }
  }

  async function confirm() {
    if (!item.label.trim()) {
      toast('Name the item', 'A collector needs to know what they are picking up.', 'am')
      return
    }
    if (!geo.coords) {
      toast('Location needed', 'Allow location, or drop the pin on the map.', 'am')
      return
    }
    setBusy(true)
    try {
      const res = await db.createPickup(user.id, {
        item_label: item.label.trim(),
        waste_type: item.type,
        condition: Number(item.condition),
        pathway: analysis?.pathway ?? pathwayFor(item.condition),
        confidence: analysis?.confidence ?? null,
        est_weight_kg: Number(item.weight),
        lat: geo.coords.lat,
        lng: geo.coords.lng,
        accuracy_m: geo.coords.accuracy,
        address: geo.address,
      }, photo)
      setOutcome(res)
      setStep(3)
      await refresh()
      toast(
        res.match ? 'Matched' : 'Logged',
        res.match
          ? `Routed to ${res.match.industry.name}, ${res.match.distance_km} km away.`
          : 'No verified industry covers that area for this material yet.'
      )
    } catch (e) {
      toast('Could not save', e.message, 'am')
    } finally {
      setBusy(false)
    }
  }

  function reset() {
    setStep(0); setMode('choose'); setPhoto(null); setPreview(null)
    setAnalysis(null); setOutcome(null); setModelErr(''); setUnclear(false)
  }

  const setI = (k) => (e) => setItem((v) => ({ ...v, [k]: e.target.value }))

  return (
    <Page
      title="Scan an item"
      sub="Point the camera at it. Category, condition and a matched recycler come back."
      right={
        <Chip tone={vision ? 'ok' : 'warn'}>
          {vision ? `VISION: ${vision}` : 'NO VISION MODEL'}
        </Chip>
      }
    >
      <Steps steps={['CAPTURE', 'ANALYSE', 'CONFIRM', 'MATCHED']} current={step} />

      <div className="grid g2">
        {/* ---------- left: capture ---------- */}
        <div>
          {mode === 'camera' ? (
            <Camera onCapture={handle} onCancel={() => setMode('choose')} />
          ) : (
            <div
              className={`drop ${step === 1 ? 'scanning' : ''} ${analysis && !unclear ? 'done' : ''} ${hot ? 'hot' : ''}`}
              onClick={() => step === 0 && fileRef.current?.click()}
              onKeyDown={(e) => {
                if ((e.key === 'Enter' || e.key === ' ') && step === 0) {
                  e.preventDefault(); fileRef.current?.click()
                }
              }}
              onDragOver={(e) => { e.preventDefault(); setHot(true) }}
              onDragLeave={() => setHot(false)}
              onDrop={(e) => { e.preventDefault(); setHot(false); handle(e.dataTransfer.files?.[0]) }}
              role="button" tabIndex={0} aria-label="Upload a photo of the item"
            >
              {preview && <img src={preview} alt="" />}
              <div className="beam" />
              {analysis && !unclear && (
                <div className="bb"><u>{item.label} · {Number(item.condition).toFixed(1)}</u></div>
              )}
              {!preview && (
                <div className="ph"><b>DROP A PHOTO</b>or click to choose · jpg / png</div>
              )}
              <input ref={fileRef} type="file" accept="image/*" hidden
                onChange={(e) => handle(e.target.files?.[0])} />
            </div>
          )}

          {step === 0 && mode === 'choose' && (
            <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
              <button className="btn" onClick={() => setMode('camera')}>◉ Open camera</button>
              <button className="btn ghost" onClick={() => fileRef.current?.click()}>Choose a photo</button>
            </div>
          )}
          {step > 0 && mode === 'choose' && (
            <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
              <button className="btn ghost sm" onClick={reset}>Retake</button>
            </div>
          )}

          {/* ---------- location ---------- */}
          <Card title="Pickup location" hint="Where a collector will actually come."
            style={{ marginTop: 14 }}>
            {geo.status === 'ready' ? (
              <>
                <LocationPicker
                  value={geo.coords}
                  onChange={(p) => geo.setManual(p.lat, p.lng)}
                  onUseMyLocation={() => geo.locate()}
                  locating={geo.status === 'locating'}
                  caption="DRAG THE PIN IF IT IS OFF"
                  height={220}
                />
                <div style={{ marginTop: 12 }}>
                  <KV k="ADDRESS">
                    {geo.resolving ? 'resolving…' : geo.address || '—'}
                  </KV>
                  <KV k="ACCURACY">
                    <span style={{ color: geo.coords.accuracy > 100 ? 'var(--amber)' : 'var(--muted)' }}>
                      {accuracyNote(geo.coords.accuracy)}
                    </span>
                  </KV>
                </div>
              </>
            ) : (
              <>
                <Banner tone={geo.error ? 'warn' : ''} label={geo.status.toUpperCase()}>
                  {geo.error || 'Getting your location…'}
                </Banner>
                <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                  <button className="btn ghost sm" onClick={() => geo.locate()}>
                    {geo.status === 'locating' ? 'Locating…' : 'Try again'}
                  </button>
                  <button className="btn ghost sm"
                    onClick={() => geo.setManual(17.4485, 78.3908)}>Drop a pin by hand</button>
                </div>
              </>
            )}
          </Card>
        </div>

        {/* ---------- right: analysis + confirm ---------- */}
        <Card
          title={step === 3 ? 'Pickup created' : step === 2 ? 'Check the details' : 'Analysis'}
          hint={
            step === 0 ? 'Nothing captured yet.'
              : step === 1 ? `Asking ${vision || 'the vision model'}…`
              : step === 2 ? 'Everything here is editable — you have the last word.'
              : 'Here is where it is going.'
          }
        >
          {step === 0 && (
            <Empty title="Waiting for a photo">
              camera → category → condition<br />→ industry match → batched pickup
            </Empty>
          )}

          {step === 1 && (
            <div className="mono" style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 2.1 }}>
              // uploading frame…<br />// {vision || 'model'} is looking…<br />// scoring condition…
            </div>
          )}

          {step === 2 && (
            <>
              {modelErr && (
                <div style={{ marginBottom: 16 }}>
                  <Banner tone="bad" label="MODEL">
                    {modelErr} Fill the details in yourself and the pickup still goes through.
                  </Banner>
                </div>
              )}
              {unclear && (
                <div style={{ marginBottom: 16 }}>
                  <Banner tone="warn" label="UNCLEAR">
                    {vision} could not make out a discardable item
                    {analysis?.item_label ? ` — it saw "${analysis.item_label}"` : ''}. Retake the
                    photo, or describe it yourself.
                  </Banner>
                </div>
              )}
              {analysis && !unclear && (
                <>
                  <KV k="MODEL SAID">{analysis.item_label}</KV>
                  <KV k="CONFIDENCE">{Number(analysis.confidence).toFixed(1)}%</KV>
                  <div className="meter" style={{ margin: '10px 0 20px' }}>
                    <i style={{ width: `${Number(analysis.confidence)}%` }} />
                  </div>
                </>
              )}

              <Field label="WHAT IS IT?">
                <input type="text" value={item.label} onChange={setI('label')}
                  placeholder="Cardboard cartons" />
              </Field>
              <Field label="CATEGORY">
                <select value={item.type} onChange={setI('type')}>
                  {WASTE_TYPES.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
                </select>
              </Field>
              <div className="row2">
                <Field label={`CONDITION — ${Number(item.condition).toFixed(1)} / 10`}
                  hint={pathwayFor(item.condition)}>
                  <input type="range" min="0" max="10" step="0.1" value={item.condition}
                    onChange={setI('condition')} />
                </Field>
                <Field label="APPROX WEIGHT (KG)">
                  <input type="number" min="0.1" step="0.1" value={item.weight} onChange={setI('weight')} />
                </Field>
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
                <button className="btn" onClick={confirm} disabled={busy || !geo.coords}>
                  {busy ? 'Finding a recycler…' : 'Request pickup'}
                </button>
                <button className="btn ghost" onClick={reset}>Start over</button>
              </div>
              {!geo.coords && (
                <div style={{ color: 'var(--amber)', fontSize: 12, marginTop: 10 }}>
                  Set a pickup location first.
                </div>
              )}
            </>
          )}

          {step === 3 && outcome && (
            <>
              {outcome.match ? (
                <>
                  <div style={{ marginBottom: 16 }}>
                    <Banner tone="ok" label="MATCHED">
                      <b>{outcome.match.industry.name}</b> accepts {wasteLabel(item.type)} and has
                      enrolled your area. {outcome.match.distance_km} km away.
                    </Banner>
                  </div>
                  <KV k="ITEM">{outcome.pickup.item_label}</KV>
                  <KV k="WEIGHT">{kg(outcome.pickup.est_weight_kg)}</KV>
                  <KV k="FROM">{outcome.pickup.address}</KV>
                  <KV k="STATUS"><Chip tone="info">Waiting to be batched</Chip></KV>
                  <div style={{ color: 'var(--muted)', fontSize: 12.5, lineHeight: 1.7, margin: '14px 0 18px' }}>
                    It will not be collected on its own. It joins the queue for your area and goes
                    out when enough nearby pickups make one van run worthwhile.
                  </div>
                </>
              ) : (
                <div style={{ marginBottom: 16 }}>
                  <Banner tone="warn" label="QUEUED">
                    No verified industry has enrolled this area for {wasteLabel(item.type)} yet. The
                    item stays logged and is matched automatically as soon as one does.
                  </Banner>
                </div>
              )}
              <div style={{ display: 'flex', gap: 10 }}>
                <button className="btn" onClick={() => nav('/u/pickups')}>See my pickups</button>
                <button className="btn ghost" onClick={reset}>Scan another</button>
              </div>
            </>
          )}
        </Card>
      </div>
    </Page>
  )
}

const pathwayFor = (c) =>
  c >= 7 ? 'REUSABLE · DONATE' : c >= 5 ? 'REPAIRABLE · REFURBISH' : c >= 2 ? 'RECYCLABLE' : 'NOT RECOVERABLE'

export function UserPickups() {
  const { user } = useAuth()
  const toast = useToast()
  const [rows, setRows] = useState([])

  const load = () => db.myPickups(user.id).then(setRows).catch(() => {})
  useEffect(() => { load() }, [user.id])

  const points = useMemo(
    () => rows.filter((r) => r.status !== 'cancelled').map((r) => ({
      lat: r.lat, lng: r.lng, label: r.item_label,
      kind: r.status === 'delivered' ? 'muted' : 'stop',
    })),
    [rows]
  )

  return (
    <Page title="My pickups" sub="Every item you have handed over, and where it is now.">
      {rows.length === 0 ? (
        <Card><Empty title="No pickups yet">Scan something and it will appear here.</Empty></Card>
      ) : (
        <>
          <div className="grid g2">
            <Card title="Where they came from" hint="Schematic plan view of your drop points.">
              <MapPlot points={points} caption="YOUR PICKUP POINTS" />
            </Card>
            <Card title="Status" hint="What each state means.">
              <KV k="REQUESTED">Logged, waiting for an industry to cover the area</KV>
              <KV k="MATCHED">Assigned to a recycler, waiting for a batch</KV>
              <KV k="IN A RUN">Scheduled into a van run</KV>
              <KV k="COLLECTED">Picked up, on the way to the industry</KV>
              <KV k="DELIVERED">Handed over and verified — points paid</KV>
            </Card>
          </div>

          <Card title="All items">
            <div className="tablewrap">
              <table>
                <thead>
                  <tr><th>ITEM</th><th>TYPE</th><th>WEIGHT</th><th>FROM</th><th>STATUS</th><th>POINTS</th><th /></tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td>{r.item_label}</td>
                      <td><Chip dot={false}>{wasteLabel(r.waste_type)}</Chip></td>
                      <td className="num">{kg(r.est_weight_kg)}</td>
                      <td style={{ color: 'var(--muted)' }}>{r.address}</td>
                      <td><Chip tone={PICKUP_STATUS[r.status]?.tone}>{PICKUP_STATUS[r.status]?.label}</Chip></td>
                      <td className="num" style={{ color: r.points_awarded ? 'var(--amber)' : 'var(--faint)' }}>
                        {r.points_awarded ? `+${r.points_awarded}` : '—'}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {['requested', 'matched'].includes(r.status) && (
                          <button className="btn ghost sm" onClick={async () => {
                            await db.cancelPickup(r.id); toast('Cancelled', r.item_label); load()
                          }}>Cancel</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </Page>
  )
}
