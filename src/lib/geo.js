/* Small geodesic helpers. Everything takes/returns { lat, lng }. */

export const R_EARTH_KM = 6371

const rad = (d) => (d * Math.PI) / 180

/** Great-circle distance in km between two points. */
export function haversineKm(a, b) {
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R_EARTH_KM * Math.asin(Math.min(1, Math.sqrt(s)))
}

/** Arithmetic centre of a set of points. Fine at city scale. */
export function centroid(points) {
  if (!points.length) return null
  let lat = 0
  let lng = 0
  for (const p of points) {
    lat += p.lat
    lng += p.lng
  }
  return { lat: lat / points.length, lng: lng / points.length }
}

/** Total length of an ordered path. */
export function pathLengthKm(points) {
  let d = 0
  for (let i = 1; i < points.length; i++) d += haversineKm(points[i - 1], points[i])
  return d
}

/**
 * Greedy nearest-neighbour ordering of `stops` walking out from `start`.
 * Returns a new array; does not mutate the input.
 */
export function nearestNeighbourOrder(start, stops) {
  const left = stops.slice()
  const out = []
  let cur = start
  while (left.length) {
    let best = 0
    let bestD = Infinity
    for (let i = 0; i < left.length; i++) {
      const d = haversineKm(cur, left[i])
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
    cur = left[best]
    out.push(left.splice(best, 1)[0])
  }
  return out
}

/**
 * 2-opt improvement on an OPEN path that is pinned at both ends:
 * start -> stops... -> end. Only the middle may be reordered.
 */
export function twoOpt(start, stops, end, maxPasses = 40) {
  if (stops.length < 3) return stops.slice()
  const order = stops.slice()
  const legs = (arr) => pathLengthKm([start, ...arr, end])
  let best = legs(order)
  for (let pass = 0; pass < maxPasses; pass++) {
    let improved = false
    for (let i = 0; i < order.length - 1; i++) {
      for (let k = i + 1; k < order.length; k++) {
        const cand = order
          .slice(0, i)
          .concat(order.slice(i, k + 1).reverse(), order.slice(k + 1))
        const d = legs(cand)
        if (d < best - 1e-9) {
          best = d
          order.splice(0, order.length, ...cand)
          improved = true
        }
      }
    }
    if (!improved) break
  }
  return order
}

/** Metres-per-degree scaling so a lat/lng box can be drawn on a square plot. */
export function toPlotXY(p, bounds) {
  const { minLat, maxLat, minLng, maxLng } = bounds
  const x = (p.lng - minLng) / (maxLng - minLng || 1)
  const y = 1 - (p.lat - minLat) / (maxLat - minLat || 1)
  return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) }
}

export function boundsOf(points, pad = 0.15) {
  const lats = points.map((p) => p.lat)
  const lngs = points.map((p) => p.lng)
  let minLat = Math.min(...lats)
  let maxLat = Math.max(...lats)
  let minLng = Math.min(...lngs)
  let maxLng = Math.max(...lngs)
  const dLat = (maxLat - minLat || 0.02) * pad
  const dLng = (maxLng - minLng || 0.02) * pad
  minLat -= dLat
  maxLat += dLat
  minLng -= dLng
  maxLng += dLng
  return { minLat, maxLat, minLng, maxLng }
}
