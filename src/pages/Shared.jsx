import { useEffect, useState } from 'react'
import { Page } from '../components/Shell.jsx'
import { Card, Chip, Empty, Stat, ago, kg, km } from '../components/ui.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { db } from '../lib/db.js'

export function Inbox() {
  const { user } = useAuth()
  const [rows, setRows] = useState([])

  const load = () => db.myNotifications(user.id).then(setRows).catch(() => {})
  useEffect(() => { load() }, [user.id])

  const unread = rows.filter((r) => !r.read).length

  return (
    <Page
      title="Notifications"
      sub={unread ? `${unread} unread` : 'All caught up.'}
      right={
        rows.length > 0 && (
          <button className="btn ghost sm" onClick={async () => {
            await db.markAllRead(user.id); load()
          }}>Mark all read</button>
        )
      }
    >
      <Card>
        {rows.length === 0 ? (
          <Empty title="Nothing yet">
            Matches, offered runs and delivery confirmations land here.
          </Empty>
        ) : (
          rows.map((n) => (
            <div key={n.id} style={{
              display: 'flex', gap: 14, padding: '14px 0',
              borderBottom: '1px solid rgba(59,224,127,.08)',
              opacity: n.read ? 0.55 : 1,
            }}>
              <div style={{ flex: 'none', paddingTop: 2 }}>
                <Chip tone={n.kind === 'run' ? 'warn' : n.kind === 'reward' ? 'ok' : 'info'} dot={false}>
                  {n.kind.toUpperCase()}
                </Chip>
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 14, marginBottom: 3 }}>{n.title}</div>
                <div style={{ color: 'var(--muted)', fontSize: 13, lineHeight: 1.6 }}>{n.body}</div>
              </div>
              <div className="num" style={{ color: 'var(--faint)', flex: 'none' }}>{ago(n.created_at)}</div>
            </div>
          ))
        )}
      </Card>
    </Page>
  )
}

export function Hub() {
  const [events, setEvents] = useState([])

  useEffect(() => {
    const tick = () => db.hubEvents().then(setEvents).catch(() => {})
    tick()
    const t = setInterval(tick, 4000)
    return () => clearInterval(t)
  }, [])

  const totalKg = events.reduce((s, e) => s + Number(e.payload?.weight_kg || 0), 0)
  // what these loads would have cost as separate trips, minus what they cost batched
  const totalSaved = events.reduce(
    (s, e) =>
      s + Math.max(0, Number(e.payload?.solo_distance_km || 0) - Number(e.payload?.distance_km || 0)),
    0
  )

  return (
    <Page title="Hub feed" sub="Every completed delivery lands here as it happens.">
      <div className="grid g3">
        <Stat value={events.length} label="DELIVERIES LOGGED" tone="em" />
        <Stat value={kg(totalKg)} label="MATERIAL RECOVERED" />
        <Stat value={km(totalSaved)} label="DRIVING AVOIDED" tone="am" />
      </div>

      <Card title="Event log" hint="Written by the delivery trigger, not by the app.">
        {events.length === 0 ? (
          <Empty title="Quiet so far">
            Complete a run in the delivery portal and it will appear here within a few seconds.
          </Empty>
        ) : (
          <div className="tablewrap">
            <table>
              <thead>
                <tr><th>EVENT</th><th>RUN</th><th>WEIGHT</th><th>ROUTE</th><th>SAVED</th><th>WHEN</th></tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id}>
                    <td><Chip tone="ok" dot={false}>{e.kind.replace(/_/g, ' ').toUpperCase()}</Chip></td>
                    <td className="num">{String(e.run_id || '').slice(0, 6).toUpperCase()}</td>
                    <td className="num">{kg(e.payload?.weight_kg)}</td>
                    <td className="num">{km(e.payload?.distance_km)}</td>
                    <td className="num" style={{ color: 'var(--em2)' }}>{e.payload?.saved_pct ?? 0}%</td>
                    <td className="num" style={{ color: 'var(--muted)' }}>{ago(e.created_at)}</td>
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
