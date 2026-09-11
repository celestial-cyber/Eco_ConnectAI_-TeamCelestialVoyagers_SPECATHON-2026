import { useCallback, useEffect, useRef, useState } from 'react'
import { reverseGeocode } from '../lib/db.js'

/**
 * Real device location, with the failure modes spelled out.
 *
 * Browsers only hand out coordinates over HTTPS or on localhost, and only
 * after the person agrees — so every state here is one a user will actually
 * hit, and each gets its own message rather than a generic "failed".
 */
export function useGeolocation({ auto = false } = {}) {
  const [state, setState] = useState({
    status: 'idle',      // idle | locating | ready | denied | unavailable | insecure
    coords: null,        // { lat, lng, accuracy }
    address: '',
    resolving: false,
    error: '',
  })
  const watchId = useRef(null)

  const secure =
    typeof window === 'undefined' ||
    window.isSecureContext ||
    ['localhost', '127.0.0.1'].includes(location.hostname)

  const locate = useCallback(
    (opts = {}) => {
      if (!('geolocation' in navigator)) {
        setState((s) => ({ ...s, status: 'unavailable', error: 'This browser has no location support.' }))
        return
      }
      if (!secure) {
        setState((s) => ({
          ...s,
          status: 'insecure',
          error: 'Location needs HTTPS. On a phone, open the site over https or use localhost.',
        }))
        return
      }

      setState((s) => ({ ...s, status: 'locating', error: '' }))
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const coords = {
            lat: round6(pos.coords.latitude),
            lng: round6(pos.coords.longitude),
            accuracy: Math.round(pos.coords.accuracy),
          }
          setState((s) => ({ ...s, status: 'ready', coords, resolving: true, error: '' }))
          try {
            const g = await reverseGeocode(coords.lat, coords.lng)
            setState((s) => ({ ...s, address: g.address || '', resolving: false }))
          } catch {
            setState((s) => ({ ...s, resolving: false }))
          }
        },
        (err) => {
          const map = {
            1: { status: 'denied', error: 'Location permission was denied. Allow it in the address bar, or drop the pin by hand.' },
            2: { status: 'unavailable', error: 'Your device could not get a fix. Try again, or drop the pin by hand.' },
            3: { status: 'unavailable', error: 'Locating timed out. Try again, or drop the pin by hand.' },
          }
          setState((s) => ({ ...s, ...(map[err.code] || { status: 'unavailable', error: err.message }) }))
        },
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000, ...opts }
      )
    },
    [secure]
  )

  /** Manual override — used when the pin is dragged on the map. */
  const setManual = useCallback(async (lat, lng) => {
    const coords = { lat: round6(lat), lng: round6(lng), accuracy: null }
    setState((s) => ({ ...s, status: 'ready', coords, resolving: true, error: '' }))
    try {
      const g = await reverseGeocode(coords.lat, coords.lng)
      setState((s) => ({ ...s, address: g.address || '', resolving: false }))
    } catch {
      setState((s) => ({ ...s, resolving: false }))
    }
  }, [])

  useEffect(() => {
    if (auto) locate()
    return () => {
      if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current)
    }
  }, [auto, locate])

  return { ...state, locate, setManual }
}

const round6 = (n) => Math.round(n * 1e6) / 1e6

/** How much to trust a GPS fix, in words. */
export const accuracyNote = (m) =>
  m == null ? 'placed by hand'
    : m <= 20 ? `±${m} m — good fix`
    : m <= 100 ? `±${m} m — approximate`
    : `±${m} m — poor fix, check the pin`
