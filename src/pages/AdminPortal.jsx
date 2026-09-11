import { useCallback, useEffect, useState } from 'react'
import { Page } from '../components/Shell.jsx'
import MapPlot from '../components/MapPlot.jsx'
import { Banner, Card, Chip, Empty, Field, KV, Stat, useToast, ago, kg } from '../components/ui.jsx'
import { db } from '../lib/db.js'
import { wasteLabel } from '../lib/waste.js'

const TONE = { verified: 'ok', pending: 'warn', rejected: 'bad' }

/**
 * The verification desk. This is deliberately a separate role: an
 * organisation approving its own registration would make the whole
 * "unverified receive nothing" rule meaningless.
 */
export default function AdminPortal() {
  const [rows, setRows] = useState([])
  const [sel, setSel] = useState(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  const load = useCallback(
    () =>
      db
        .adminIndustries()
        .then((r) => {
          setRows(r)
          setSel((cur) => (cur ? r.find((x) => x.id === cur.id) ?? null : null))
        })
        .catch((e) => toast('Could not load', e.message, 'am')),
    [toast]
  )
  useEffect(() => {
    load()
  }, [load])

  async function decide(status) {
    if (!sel) return
    if (status === 'rejected' && !note.trim()) {
      toast('Say why', 'A rejection without a reason is not actionable.', 'am')
      return
    }
    setBusy(true)
    try {
      await db.adminVerify(sel.id, status, note.trim() || null)
      setNote('')
      await load()
      toast(
        status === 'verified' ? 'Approved' : status === 'rejected' ? 'Rejected' : 'Reset',
        status === 'verified'
          ? 'Matching is live for their enrolled areas, and anything queued was rematched.'
          : 'The applicant has been notified.'
      )
    } catch (e) {
      toast('Failed', e.message, 'am')
    } finally {
      setBusy(false)
    }
  }

  const pending = rows.filter((r) => r.verification_status === 'pending')
  const verified = rows.filter((r) => r.verification_status === 'verified')

  return (
    <Page title="Verification desk" sub="Approve the organisations that receive donated material.">
      <div className="grid g3">
        <Stat value={pending.length} label="AWAITING REVIEW" tone="am" />
        <Stat value={verified.length} label="VERIFIED" tone="em" />
        <Stat value={rows.length} label="REGISTERED" />
      </div>

      {pending.length > 0 && (
        <Banner tone="warn" label="QUEUE">
          {pending.length} organisation{pending.length > 1 ? 's are' : ' is'} waiting. Until you
          approve, nothing is routed to them — donors in their area keep piling up unmatched.
        </Banner>
      )}

      <div className="grid g2">
        <Card title="Registered organisations" hint="Newest first.">
          {rows.length === 0 ? (
            <Empty title="Nothing registered yet" />
          ) : (
            <div className="tablewrap">
              <table>
                <thead>
                  <tr><th>NAME</th><th>TYPE</th><th>ACCEPTS</th><th>AREAS</th><th>STATUS</th></tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} onClick={() => { setSel(r); setNote('') }}
                      style={{ cursor: 'pointer',
                        background: sel?.id === r.id ? 'var(--bg3)' : undefined }}>
                      <td>{r.name}</td>
                      <td style={{ color: 'var(--muted)' }}>{r.org_type}</td>
                      <td className="num">{r.waste_types.length}</td>
                      <td className="num">{r.areas.length}</td>
                      <td>
                        <Chip tone={TONE[r.verification_status]}>
                          {r.verification_status.toUpperCase()}
                        </Chip>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title={sel ? sel.name : 'Select an organisation'}
          hint={sel ? 'What they submitted.' : 'Pick a row to review it.'}>
          {!sel ? (
            <Empty title="Nothing selected">
              Reviewing means checking the registration number against the public register.
            </Empty>
          ) : (
            <>
              <KV k="REG NUMBER">{sel.reg_number}</KV>
              <KV k="GST / CIN">{sel.gst_number || '—'}</KV>
              <KV k="TYPE">{sel.org_type}</KV>
              <KV k="CONTACT">{sel.contact_person || '—'} · {sel.contact_email || '—'}</KV>
              <KV k="PHONE">{sel.phone || '—'}</KV>
              <KV k="ADDRESS">
                {[sel.address, sel.city, sel.pincode].filter(Boolean).join(', ')}
              </KV>
              <KV k="CAPACITY">{sel.capacity_kg_month ? kg(sel.capacity_kg_month) + ' / month' : '—'}</KV>
              <KV k="DOCUMENT">{sel.doc_ref || 'none attached'}</KV>
              <KV k="REGISTERED">{ago(sel.created_at)}</KV>

              <div style={{ margin: '14px 0' }}>
                <div className="mono" style={{ fontSize: 9.5, letterSpacing: '.18em',
                  color: 'var(--muted)', marginBottom: 10 }}>TARGET TRASH</div>
                <div className="checks">
                  {sel.waste_types.length
                    ? sel.waste_types.map((w) => <Chip key={w} tone="ok" dot={false}>{wasteLabel(w)}</Chip>)
                    : <span style={{ color: 'var(--red)', fontSize: 13 }}>None selected</span>}
                </div>
              </div>

              <MapPlot
                points={[{ lat: sel.lat, lng: sel.lng, label: sel.name, kind: 'org' }]}
                rings={sel.areas}
                caption="FACILITY AND ENROLLED AREAS"
                height={230}
              />

              {sel.areas.length === 0 && (
                <div style={{ marginTop: 12 }}>
                  <Banner tone="warn" label="NO AREAS">
                    They have enrolled no areas, so approving changes nothing until they add one.
                  </Banner>
                </div>
              )}

              <div style={{ marginTop: 16 }}>
                <Field label="NOTE — REQUIRED TO REJECT">
                  <input type="text" value={note} onChange={(e) => setNote(e.target.value)}
                    placeholder="Registration number could not be found on the public register" />
                </Field>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <button className="btn" disabled={busy || sel.verification_status === 'verified'}
                    onClick={() => decide('verified')}>Approve</button>
                  <button className="btn danger" disabled={busy}
                    onClick={() => decide('rejected')}>Reject</button>
                  {sel.verification_status !== 'pending' && (
                    <button className="btn ghost" disabled={busy}
                      onClick={() => decide('pending')}>Send back to pending</button>
                  )}
                </div>
                {sel.verification_note && (
                  <div style={{ marginTop: 12 }}>
                    <Banner label="LAST NOTE">{sel.verification_note}</Banner>
                  </div>
                )}
              </div>
            </>
          )}
        </Card>
      </div>
    </Page>
  )
}
