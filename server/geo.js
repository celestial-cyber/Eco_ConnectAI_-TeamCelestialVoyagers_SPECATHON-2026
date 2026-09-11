/* ============================================================
   Reverse geocoding: coordinates -> a street address a driver can use.

   Nominatim (OpenStreetMap) is free and needs no key, but its usage
   policy requires a real User-Agent and at most one request a second.
   Both are enforced here, and every answer is cached in SQLite, so a
   demo with the same few locations makes almost no calls at all.

   To swap providers (Google, Mapbox, Ola Maps) replace `fetchAddress`
   — the cache, the queue and the route above it stay as they are.
   ============================================================ */

import { db, uid } from './db.js'

const UA =
  process.env.GEOCODE_USER_AGENT ||
  'EcoConnectAI/0.1 (hackathon project; contact: set GEOCODE_USER_AGENT)'
const ENDPOINT = process.env.GEOCODE_ENDPOINT || 'https://nominatim.openstreetmap.org/reverse'
const MIN_GAP_MS = 1100

let lastCall = 0
let chain = Promise.resolve()

/** Serialises calls and keeps at least MIN_GAP_MS between them. */
function queued(fn) {
  const run = chain.then(async () => {
    const wait = Math.max(0, lastCall + MIN_GAP_MS - Date.now())
    if (wait) await new Promise((r) => setTimeout(r, wait))
    lastCall = Date.now()
    return fn()
  })
  chain = run.catch(() => {})
  return run
}

// ~110m of precision is plenty for a pickup address and makes the cache hit often
const keyFor = (lat, lng) => `${Number(lat).toFixed(3)},${Number(lng).toFixed(3)}`

export function cachedAddress(lat, lng) {
  const row = db.prepare('select address from geocache where key = ?').get(keyFor(lat, lng))
  return row?.address ?? null
}

async function fetchAddress(lat, lng) {
  const url = `${ENDPOINT}?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new Error(`Geocoder returned ${res.status}`)
  const j = await res.json()
  const a = j.address || {}
  // Build something a driver would actually recognise, not the full 9-part string
  const parts = [
    a.house_number && a.road ? `${a.house_number} ${a.road}` : a.road,
    a.neighbourhood || a.suburb || a.village,
    a.city || a.town || a.county,
    a.postcode,
  ].filter(Boolean)
  return { address: parts.join(', ') || j.display_name || '', raw: j }
}

/**
 * Returns a human address for a coordinate. Falls back to the coordinate
 * itself rather than failing the request — a pickup with a slightly ugly
 * address is far better than a pickup that could not be created.
 */
export async function reverseGeocode(lat, lng) {
  const key = keyFor(lat, lng)
  const hit = db.prepare('select address from geocache where key = ?').get(key)
  if (hit) return { address: hit.address, cached: true }

  try {
    const { address, raw } = await queued(() => fetchAddress(lat, lng))
    if (address) {
      db.prepare('insert or replace into geocache (key,address,raw,created_at) values (?,?,?,?)')
        .run(key, address, JSON.stringify(raw).slice(0, 4000), new Date().toISOString())
    }
    return { address, cached: false }
  } catch (e) {
    return {
      address: `${Number(lat).toFixed(4)}, ${Number(lng).toFixed(4)}`,
      cached: false,
      degraded: true,
      reason: e.message,
    }
  }
}
