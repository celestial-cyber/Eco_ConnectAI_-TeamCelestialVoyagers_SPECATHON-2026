import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext.jsx'
import { ToastHost } from './components/ui.jsx'
import Shell from './components/Shell.jsx'
import { Login, Signup } from './pages/Auth.jsx'
import { UserHome, UserPickups, UserScan } from './pages/UserPortal.jsx'
import {
  IndustryHome, IndustryProfile, IndustryQueue, IndustryRuns,
} from './pages/IndustryPortal.jsx'
import {
  DeliveryHome, DeliveryProfile, DeliveryRunDetail, DeliveryRuns,
} from './pages/DeliveryPortal.jsx'
import { Hub, Inbox } from './pages/Shared.jsx'
import AdminPortal from './pages/AdminPortal.jsx'

const HOME = { user: '/u', industry: '/i', delivery: '/d', admin: '/a' }

function Splash({ note }) {
  return (
    <div style={{
      minHeight: '100%', display: 'grid', placeItems: 'center',
      fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: '.22em', color: 'var(--muted)',
    }}>
      {note}
    </div>
  )
}

/** Only lets a signed-in account of the right role through. */
function Guard({ role, children }) {
  const { user, ready } = useAuth()
  if (!ready) return <Splash note="LOADING…" />
  if (!user) return <Navigate to="/login" replace />
  if (role && user.role !== role) return <Navigate to={HOME[user.role] ?? '/login'} replace />
  return children
}

function Landing() {
  const { user, ready } = useAuth()
  if (!ready) return <Splash note="LOADING…" />
  return <Navigate to={user ? HOME[user.role] ?? '/login' : '/login'} replace />
}

/** Signed-in but role-agnostic pages (inbox, hub). */
function AnyRole({ children }) {
  const { user, ready } = useAuth()
  if (!ready) return <Splash note="LOADING…" />
  if (!user) return <Navigate to="/login" replace />
  return children
}

export default function App() {
  return (
    <HashRouter>
      <AuthProvider>
        <ToastHost>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />

            <Route element={<AnyRole><Shell /></AnyRole>}>
              <Route path="/inbox" element={<Inbox />} />
              <Route path="/hub" element={<Hub />} />

              <Route path="/u" element={<Guard role="user"><UserHome /></Guard>} />
              <Route path="/u/scan" element={<Guard role="user"><UserScan /></Guard>} />
              <Route path="/u/pickups" element={<Guard role="user"><UserPickups /></Guard>} />

              <Route path="/i" element={<Guard role="industry"><IndustryHome /></Guard>} />
              <Route path="/i/queue" element={<Guard role="industry"><IndustryQueue /></Guard>} />
              <Route path="/i/runs" element={<Guard role="industry"><IndustryRuns /></Guard>} />
              <Route path="/i/profile" element={<Guard role="industry"><IndustryProfile /></Guard>} />

              <Route path="/d" element={<Guard role="delivery"><DeliveryHome /></Guard>} />
              <Route path="/d/runs" element={<Guard role="delivery"><DeliveryRuns /></Guard>} />
              <Route path="/d/runs/:id" element={<Guard role="delivery"><DeliveryRunDetail /></Guard>} />
              <Route path="/d/profile" element={<Guard role="delivery"><DeliveryProfile /></Guard>} />

              <Route path="/a" element={<Guard role="admin"><AdminPortal /></Guard>} />
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </ToastHost>
      </AuthProvider>
    </HashRouter>
  )
}
