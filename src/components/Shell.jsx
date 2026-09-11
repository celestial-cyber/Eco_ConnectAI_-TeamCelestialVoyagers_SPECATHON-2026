import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { db } from '../lib/db.js'

const NAV = {
  user: [
    { to: '/u', end: true, label: 'Overview' },
    { to: '/u/scan', label: 'Scan an item' },
    { to: '/u/pickups', label: 'My pickups' },
  ],
  industry: [
    { to: '/i', end: true, label: 'Overview' },
    { to: '/i/queue', label: 'Incoming scrap' },
    { to: '/i/runs', label: 'Deliveries' },
    { to: '/i/profile', label: 'Registration' },
  ],
  delivery: [
    { to: '/d', end: true, label: 'Overview' },
    { to: '/d/runs', label: 'My runs' },
    { to: '/d/profile', label: 'Agent & vehicle' },
  ],
  admin: [{ to: '/a', end: true, label: 'Verification desk' }],
}

const ROLE_LABEL = {
  user: 'DONOR PORTAL',
  industry: 'INDUSTRY / NGO PORTAL',
  delivery: 'DELIVERY PORTAL',
  admin: 'VERIFICATION DESK',
}

export default function Shell() {
  const { user, signOut } = useAuth()
  const nav = useNavigate()
  const [unread, setUnread] = useState(0)

  useEffect(() => {
    if (!user) return
    let alive = true
    const tick = () =>
      db
        .myNotifications(user.id)
        .then((n) => alive && setUnread(n.filter((x) => !x.read).length))
        .catch(() => {})
    tick()
    const t = setInterval(tick, 4000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [user])

  if (!user) return null
  const items = NAV[user.role] ?? []

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">
          <i />
          ECOCONNECT<span style={{ color: 'var(--em2)' }}>·</span>AI
        </div>
        <div className="roletag">{ROLE_LABEL[user.role]}</div>
        <nav className="nav">
          {items.map((it) => (
            <NavLink key={it.to} to={it.to} end={it.end} className={({ isActive }) => (isActive ? 'on' : '')}>
              {it.label}
            </NavLink>
          ))}
          <NavLink to="/inbox" className={({ isActive }) => (isActive ? 'on' : '')}>
            Notifications
            {unread > 0 && <span className="ct">{unread}</span>}
          </NavLink>
          <NavLink to="/hub" className={({ isActive }) => (isActive ? 'on' : '')}>
            Hub feed
          </NavLink>
        </nav>
        <div className="foot">
          <b>{user.full_name}</b>
          <div style={{ fontSize: 11.5 }}>{user.email}</div>
          <button
            className="linkish"
            onClick={async () => {
              await signOut()
              nav('/login')
            }}
          >
            Sign out
          </button>
          <a className="linkish" style={{ display: 'block' }} href="/index.html">
            ← Back to the site
          </a>
        </div>
      </aside>

      <div className="main">
        <Outlet />
      </div>

    </div>
  )
}

export function Page({ title, sub, right, children }) {
  return (
    <>
      <div className="topline">
        <div style={{ minWidth: 0 }}>
          <h1>{title}</h1>
          {sub && <div className="sub">{sub}</div>}
        </div>
        {right && <div className="right">{right}</div>}
      </div>
      <div className="page">{children}</div>
    </>
  )
}
