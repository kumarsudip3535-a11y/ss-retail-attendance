import { haversineDistanceMeters } from './geo'

export interface PointLike {
  lat: number
  lng: number
  timestamp: { toMillis(): number }
}

export interface StopCandidate {
  /** Index into the points array where this cluster begins (inclusive). */
  startIdx: number
  /** Index into the points array where this cluster ends (inclusive). */
  endIdx: number
  lat: number
  lng: number
  arrivalMs: number
  departureMs: number
  durationMinutes: number
}

/**
 * Dwell-radius clustering: groups consecutive points that stay within
 * `radiusMeters` of the cluster's running centroid, and reports any
 * cluster whose time span meets `minDurationMinutes` as a Stop.
 *
 * This is a deliberately simple v1 heuristic — it re-centroids on every
 * point folded into the current cluster (cheap at realistic per-employee
 * daily point counts) and closes a cluster as soon as one point falls
 * outside the radius. It does NOT yet try to re-absorb a single noisy
 * outlier point back into a cluster (one bad GPS reading mid-stop could
 * split one real stop into two short ones) — worth revisiting once
 * there's real field data to tune against, not blocking for a first
 * version.
 */
export function detectStops<T extends PointLike>(
  points: T[],
  radiusMeters: number,
  minDurationMinutes: number
): StopCandidate[] {
  if (points.length === 0) return []

  const stops: StopCandidate[] = []

  let clusterStart = 0
  let centroidLat = points[0].lat
  let centroidLng = points[0].lng
  let clusterSize = 1

  const finalizeCluster = (endIdx: number) => {
    if (endIdx <= clusterStart) return
    const arrivalMs = points[clusterStart].timestamp.toMillis()
    const departureMs = points[endIdx].timestamp.toMillis()
    const durationMinutes = Math.round(((departureMs - arrivalMs) / 60000) * 10) / 10
    if (durationMinutes >= minDurationMinutes) {
      stops.push({
        startIdx: clusterStart,
        endIdx,
        lat: centroidLat,
        lng: centroidLng,
        arrivalMs,
        departureMs,
        durationMinutes,
      })
    }
  }

  for (let i = 1; i < points.length; i++) {
    const dist = haversineDistanceMeters(centroidLat, centroidLng, points[i].lat, points[i].lng)
    if (dist <= radiusMeters) {
      // Still within the same stop — fold into the running centroid.
      centroidLat = (centroidLat * clusterSize + points[i].lat) / (clusterSize + 1)
      centroidLng = (centroidLng * clusterSize + points[i].lng) / (clusterSize + 1)
      clusterSize += 1
    } else {
      finalizeCluster(i - 1)
      clusterStart = i
      centroidLat = points[i].lat
      centroidLng = points[i].lng
      clusterSize = 1
    }
  }
  finalizeCluster(points.length - 1)

  return stops
}
