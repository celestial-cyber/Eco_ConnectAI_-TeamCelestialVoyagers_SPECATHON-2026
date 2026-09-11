/* ============================================================
   API client. The browser holds no keys and makes no decisions —
   it asks the server, which owns the database, the model key and
   every rule that matters.
   ============================================================ */

const BASE = import.meta.env?.VITE_API_URL || '/api'
const TOKEN_KEY = 'eco.token'

export const getToken = () => {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}
const setToken = (t) => {
  try {
    t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY)
  } catch {}
}

async function req(path, { method = 'GET', body, form, signal } = {}) {
  const token = getToken()
  let res
  try {
    res = await fetch(BASE + path, {
      method,
      signal,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: form ?? (body ? JSON.stringify(body) : undefined),
    })
  } catch {
    throw new Error('Cannot reach the server. Is it running on port 8787?')
  }

  if (res.status === 401 && token) {
    setToken(null) // expired session — drop it rather than loop
  }

  let json = null
  try {
    json = await res.json()
  } catch {}

  if (!res.ok) throw new Error(json?.error || `Request failed (${res.status}).`)
  return json
}

/* ---------------- health ---------------- */
let health = null
export async function serverInfo() {
  if (health) return health
  try {
    health = await req('/health')
  } catch {
    health = { ok: false, vision: null }
  }
  return health
}

/* ---------------- vision ---------------- */
export async function classify(file) {
  if (typeof window !== 'undefined' && typeof window.ECO_CLASSIFY === 'function') {
    return { ...(await window.ECO_CLASSIFY(file)), source: 'custom' }
  }
  const form = new FormData()
  form.append('image', file, file.name || 'capture.jpg')
  const r = await req('/classify', { method: 'POST', form })
  return { ...r, source: 'server' }
}

/* ---------------- geocoding ---------------- */
export const reverseGeocode = (lat, lng) =>
  req(`/geo/reverse?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}`)

/* ---------------- the app surface ---------------- */
export const db = {
  /* auth */
  async getSession() {
    if (!getToken()) return null
    try {
      const { user } = await req('/auth/me')
      return { user }
    } catch {
      return null
    }
  },
  async signIn({ email, password }) {
    const r = await req('/auth/login', { method: 'POST', body: { email, password } })
    setToken(r.token)
    return { user: r.user }
  },
  async signUp(data) {
    const r = await req('/auth/signup', { method: 'POST', body: data })
    setToken(r.token)
    return { user: r.user }
  },
  async signOut() {
    setToken(null)
  },

  /* industry */
  getMyIndustry: () => req('/industries/mine'),
  createIndustry: (_profileId, data) => req('/industries', { method: 'POST', body: data }),
  updateIndustry: (id, patch) => req(`/industries/${id}`, { method: 'PATCH', body: patch }),
  addArea: (id, area) => req(`/industries/${id}/areas`, { method: 'POST', body: area }),
  removeArea: (id, areaId) => req(`/industries/${id}/areas/${areaId}`, { method: 'DELETE' }),
  industryPickups: (id) => req(`/industries/${id}/pickups`),
  industryRuns: (id) => req(`/industries/${id}/runs`),
  allIndustries: () => req('/industries'),

  /* admin */
  adminIndustries: () => req('/admin/industries'),
  adminVerify: (id, status, note) =>
    req(`/admin/industries/${id}/verify`, { method: 'POST', body: { status, note } }),

  /* delivery */
  getMyAgent: () => req('/agents/mine'),
  createAgent: (_profileId, data) => req('/agents', { method: 'POST', body: data }),
  setAgentStatus: (_agentId, status) => req('/agents/status', { method: 'PATCH', body: { status } }),
  agentRuns: () => req('/agents/runs'),
  acceptRun: (id) => req(`/runs/${id}/accept`, { method: 'POST' }),
  startRun: (id) => req(`/runs/${id}/start`, { method: 'POST' }),
  markStopPicked: (runId, pickupId) =>
    req(`/runs/${runId}/stops/${pickupId}/picked`, { method: 'POST' }),
  deliverRun: (id, qr_token) => req(`/runs/${id}/deliver`, { method: 'POST', body: { qr_token } }),

  /* pickups */
  createPickup(_profileId, data, photo) {
    const form = new FormData()
    for (const [k, v] of Object.entries(data)) {
      if (v !== null && v !== undefined) form.append(k, String(v))
    }
    if (photo) form.append('photo', photo, photo.name || 'photo.jpg')
    return req('/pickups', { method: 'POST', form })
  },
  myPickups: () => req('/pickups/mine'),
  cancelPickup: (id) => req(`/pickups/${id}/cancel`, { method: 'POST' }),
  photoUrl: (id) => `${BASE}/pickups/${id}/photo`,

  /* batching */
  runBatching: () => req('/batch/run', { method: 'POST' }),

  /* notifications + hub */
  myNotifications: () => req('/notifications'),
  markAllRead: () => req('/notifications/read', { method: 'POST' }),
  hubEvents: () => req('/hub'),
}
