import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

/* Real OpenStreetMap data on a dark basemap, so the map reads on the same
   ground as the rest of the console. Swap providers with VITE_TILE_URL. */
export const TILE_URL =
  import.meta.env?.VITE_TILE_URL ||
  'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
export const TILE_ATTR =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'

/** Markers are styled divs, not image pins — no bundler icon-path problems. */
export function dot(kind = 'stop', label = '') {
  const cls = kind === 'org' ? 'm-org' : kind === 'muted' ? 'm-mute' : kind === 'me' ? 'm-me' : 'm-stop'
  return L.divIcon({
    className: 'ecomark',
    html: `<i class="${cls}"></i>${label ? `<b>${escapeHtml(label)}</b>` : ''}`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  })
}

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  )

/**
 * points: [{ lat, lng, label?, kind?: 'org'|'stop'|'muted'|'me' }]
 * route:  ordered [{ lat, lng }] drawn as a line
 * rings:  [{ lat, lng, radius_km }] drawn as catchment circles
 */
export default function MapPlot({ points = [], route = [], rings = [], caption, height }) {
  const el = useRef(null)
  const map = useRef(null)
  const layer = useRef(null)

  useEffect(() => {
    if (map.current || !el.current) return
    map.current = L.map(el.current, {
      zoomControl: true,
      attributionControl: true,
      scrollWheelZoom: false, // page scroll should not zoom the map by accident
    }).setView([17.4485, 78.3908], 12)
    L.tileLayer(TILE_URL, { attribution: TILE_ATTR, maxZoom: 19 }).addTo(map.current)
    layer.current = L.layerGroup().addTo(map.current)
    // the container is sized by CSS, which Leaflet cannot know about up front
    setTimeout(() => map.current?.invalidateSize(), 60)
    return () => {
      map.current?.remove()
      map.current = null
    }
  }, [])

  useEffect(() => {
    if (!map.current || !layer.current) return
    layer.current.clearLayers()
    const bounds = []

    for (const r of rings) {
      if (!Number.isFinite(r?.lat)) continue
      L.circle([r.lat, r.lng], {
        radius: Number(r.radius_km) * 1000,
        color: '#3be07f', weight: 1, opacity: 0.55,
        fillColor: '#22c55e', fillOpacity: 0.06, dashArray: '5 5',
      }).addTo(layer.current)
      bounds.push([r.lat, r.lng])
    }

    const line = route.filter((p) => Number.isFinite(p?.lat)).map((p) => [p.lat, p.lng])
    if (line.length > 1) {
      L.polyline(line, { color: '#3be07f', weight: 2.5, opacity: 0.9 }).addTo(layer.current)
      bounds.push(...line)
    }

    for (const p of points) {
      if (!Number.isFinite(p?.lat)) continue
      L.marker([p.lat, p.lng], { icon: dot(p.kind, p.label) })
        .addTo(layer.current)
        .bindPopup(p.popup || p.label || '')
      bounds.push([p.lat, p.lng])
    }

    if (bounds.length === 1) map.current.setView(bounds[0], 14)
    else if (bounds.length > 1) {
      map.current.fitBounds(L.latLngBounds(bounds).pad(0.18), { animate: false })
    }
    setTimeout(() => map.current?.invalidateSize(), 40)
  }, [points, route, rings])

  return (
    <div className="mapwrap" style={height ? { height } : undefined}>
      <div ref={el} className="mapcanvas" />
      {caption && <div className="mapcap">{caption}</div>}
    </div>
  )
}
