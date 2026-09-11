import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { Banner, Field } from '../components/ui.jsx'
import { serverInfo } from '../lib/db.js'

const HOME = { user: '/u', industry: '/i', delivery: '/d', admin: '/a' }

function Aside({ step }) {
  return (
    <div className="aside">
      <div>
        <div className="eyebrow">
          <s />
          ECOCONNECT AI
        </div>
        <h2 style={{ fontSize: 34, lineHeight: 1.02, maxWidth: '14ch' }}>
          One loop, three sides.
        </h2>
        <p style={{ color: 'var(--muted)', fontSize: 13.5, lineHeight: 1.75, maxWidth: '38ch' }}>
          A donor photographs something they no longer want. It is classified, matched to an
          industry that actually processes that material, and batched into a van run that was
          already coming down the street.
        </p>
        <div className="pipe">
          <div><em>01</em> Upload a photo of the item</div>
          <div><em>02</em> Vision returns category and condition</div>
          <div><em>03</em> Matched to a verified industry nearby</div>
          <div><em>04</em> Batched into one efficient pickup run</div>
          <div><em>05</em> QR handover, points, hub notified</div>
        </div>
      </div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 9.5, letterSpacing: '.18em', color: 'var(--faint)' }}>
        TEAM CELESTIAL VOYAGER · SPEC'THON 2026
      </div>
    </div>
  )
}

export function Login() {
  const { signIn } = useAuth()
  const nav = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [seeded, setSeeded] = useState(false)

  useEffect(() => {
    serverInfo().then((h) => setSeeded(Boolean(h.ok))).catch(() => {})
  }, [])

  async function submit(e) {
    e.preventDefault()
    setErr('')
    setBusy(true)
    try {
      const u = await signIn({ email, password })
      nav(HOME[u.role] ?? '/u')
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth">
      <Aside />
      <div className="form">
        <div className="box">
          <h2>Sign in</h2>
          <p className="lead">Continue to your portal.</p>

          {err && <div style={{ marginBottom: 16 }}><Banner tone="bad" label="ERROR">{err}</Banner></div>}

          <form onSubmit={submit}>
            <Field label="EMAIL">
              <input type="email" required value={email} autoComplete="email"
                onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            </Field>
            <Field label="PASSWORD">
              <input type="password" required value={password} autoComplete="current-password"
                onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
            </Field>
            <button className="btn wide" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 20 }}>
            No account yet? <Link to="/signup">Create one</Link>
          </p>

          {seeded && (
            <div style={{ marginTop: 22 }}>
              <Banner label="DEMO">
                Seeded accounts, password <b style={{ color: 'var(--em2)' }}>demo1234</b>:
                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {[
                    ['donor@demo.in', 'donor'],
                    ['industry@demo.in', 'industry'],
                    ['driver@demo.in', 'delivery agent'],
                    ['admin@demo.in', 'verification desk'],
                  ].map(([mail, who]) => (
                    <button key={mail} type="button" className="linkish"
                      style={{ fontFamily: 'var(--mono)', fontSize: 11.5, color: 'var(--em2)' }}
                      onClick={() => { setEmail(mail); setPassword('demo1234') }}>
                      {mail} — {who}
                    </button>
                  ))}
                </div>
              </Banner>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const ROLES = [
  { id: 'user', k: 'DONOR', h: 'I have things to give away',
    p: 'Scan an item, get its category and condition, and hand it to a collector already coming to your area.' },
  { id: 'industry', k: 'NGO / INDUSTRY', h: 'I need a specific material',
    p: 'Register your organisation and the waste streams you process, enrol the areas you serve, and receive matching scrap.' },
  { id: 'delivery', k: 'DELIVERY AGENT', h: 'I have a van',
    p: 'Register your service area and vehicle, get an agent code, and receive pickups already batched into one run.' },
]

export function Signup() {
  const { signUp } = useAuth()
  const nav = useNavigate()
  const [role, setRole] = useState('user')
  const [form, setForm] = useState({ full_name: '', email: '', phone: '', password: '' })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  async function submit(e) {
    e.preventDefault()
    setErr('')
    setBusy(true)
    try {
      const u = await signUp({ ...form, role })
      // industry and delivery both need a registration step before their portal is useful
      nav(u.role === 'industry' ? '/i/profile' : u.role === 'delivery' ? '/d/profile' : '/u')
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth">
      <Aside />
      <div className="form">
        <div className="box">
          <h2>Create an account</h2>
          <p className="lead">Pick the side of the loop you are on. This decides your portal.</p>

          <div className="roles" style={{ marginBottom: 26 }}>
            {ROLES.map((r) => (
              <button key={r.id} type="button" className={`role ${role === r.id ? 'on' : ''}`}
                onClick={() => setRole(r.id)} aria-pressed={role === r.id}>
                <span className="k">{r.k}</span>
                <h4>{r.h}</h4>
                <p>{r.p}</p>
              </button>
            ))}
          </div>

          {err && <div style={{ marginBottom: 16 }}><Banner tone="bad" label="ERROR">{err}</Banner></div>}

          <form onSubmit={submit}>
            <Field label={role === 'industry' ? 'CONTACT NAME' : 'FULL NAME'}>
              <input type="text" required value={form.full_name} onChange={set('full_name')}
                placeholder={role === 'industry' ? 'Who we should contact' : 'Your name'} />
            </Field>
            <div className="row2">
              <Field label="EMAIL">
                <input type="email" required value={form.email} onChange={set('email')}
                  autoComplete="email" placeholder="you@example.com" />
              </Field>
              <Field label="PHONE">
                <input type="text" value={form.phone} onChange={set('phone')} placeholder="+91 …" />
              </Field>
            </div>
            <Field label="PASSWORD" hint="At least 8 characters.">
              <input type="password" required minLength={8} value={form.password}
                onChange={set('password')} autoComplete="new-password" placeholder="••••••••" />
            </Field>
            <button className="btn wide" disabled={busy}>
              {busy ? 'Creating…' : 'Create account'}
            </button>
          </form>

          <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 20 }}>
            Already registered? <Link to="/login">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
