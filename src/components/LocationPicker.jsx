import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { TILE_URL, TILE_ATTR, dot } from './MapPlot.jsx'

/**
 * Drag the pin, click the map, or hit "Use my location". Nobody types
 * a latitude. `onChange({lat,lng})` fires on every move.
 */
export default function LocationPicker({
  value,
  onChange,
  landmarks = [],
  rings = [],
  caption = 'CLICK OR DRAG TO PLACE THE PIN',
  onUseMyLocation,
  locating = false,
  height,
}) {
  const el = useRef(null)
  const map = useRef(null)
  const pin = useRef(null)
  const extras = useRef(null)
  const cb = useRef(onChange)
  cb.current = onChange

  useEffect(() => {
    if (map.current || !el.current) return
    const start = value?.lat != null ? [value.lat, value.lng] : [17.4485, 78.3908]
    map.current = L.map(el.current, { scrollWheelZoom: false }).setView(start, 13)
    L.tileLayer(TILE_URL, { attribution: TILE_ATTR, maxZoom: 19 }).addTo(map.current)
    extras.current = L.layerGroup().addTo(map.current)

    pin.current = L.marker(start, { icon: dot('org', 'HERE'), draggable: true })
      .addTo(map.current)
      .on('dragend', (e) => {
        const { lat, lng } = e.target.getLatLng()
        cb.current?.({ lat: round6(lat), lng: round6(lng) })
      })

    map.current.on('click', (e) => {
      cb.current?.({ lat: round6(e.latlng.lat), lng: round6(e.latlng.lng) })
    })

    setTimeout(() => map.current?.invalidateSize(), 60)
    return () => {
      map.current?.remove()
      map.current = null
    }
  }, [])

  // keep the pin in step when the value changes from outside (GPS, landmark)
  useEffect(() => {
    if (!map.current || !pin.current || value?.lat == null) return
    const target = L.latLng(value.lat, value.lng)
    if (pin.current.getLatLng().distanceTo(target) > 1) {
      pin.current.setLatLng(target)
      map.current.setView(target, Math.max(map.current.getZoom(), 14), { animate: false })
    }
  }, [value?.lat, value?.lng])

  useEffect(() => {
    if (!extras.current) return
    extras.current.clearLayers()
    for (const r of rings) {
      if (!Number.isFinite(r?.lat)) continue
      L.circle([r.lat, r.lng], {
        radius: Number(r.radius_km) * 1000,
        color: '#3be07f', weight: 1, opacity: 0.5,
        fillColor: '#22c55e', fillOpacity: 0.05, dashArray: '5 5',
      }).addTo(extras.current)
    }
    for (const l of landmarks) {
      L.marker([l.lat, l.lng], { icon: dot('muted', l.label) })
        .addTo(extras.current)
        .on('click', () => cb.current?.({ lat: l.lat, lng: l.lng }))
    }
  }, [rings, landmarks])

  return (
    <>
      <div className="mapwrap" style={height ? { height } : undefined}>
        <div ref={el} className="mapcanvas" />
        {caption && <div className="mapcap">{caption}</div>}
      </div>

      <div className="checks" style={{ marginTop: 12 }}>
        {onUseMyLocation && (
          <button type="button" className="btn ghost sm" onClick={onUseMyLocation} disabled={locating}>
            {locating ? 'Locating…' : '◎ Use my location'}
          </button>
        )}
        {landmarks.map((l) => (
          <button key={l.label} type="button" className="check"
            onClick={() => onChange?.({ lat: l.lat, lng: l.lng })}>
            {l.label}
          </button>
        ))}
      </div>

      {value?.lat != null && (
        <div className="mono" style={{ marginTop: 10, fontSize: 10.5, letterSpacing: '.1em', color: 'var(--muted)' }}>
          {Number(value.lat).toFixed(5)}, {Number(value.lng).toFixed(5)}
        </div>
      )}
    </>
  )
}

const round6 = (n) => Math.round(n * 1e6) / 1e6
