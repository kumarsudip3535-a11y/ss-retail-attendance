/**
 * Phase T2 distance fix — the single source of truth for "how far did this
 * employee actually travel" from a list of raw GPS fixes.
 *
 * IMPORTANT: an identical copy lives at functions/src/routeDistance.ts
 * (Cloud Functions is a separate npm package with no shared build step —
 * same duplication rule as geo.ts). Keep both files byte-for-byte in sync.
 *
 * Why the old math under-reported a 20 km trip:
 *
 *  1. Glitch filter compared each point to its *immediate* predecessor,
 *     even when that predecessor had itself just been rejected as a
 *     glitch. One bad fix therefore also knocked out the next real one
 *     (its distance was measured from the bad point) — and the real leg
 *     was silently dropped from the total.
 *  2. Points were timestamped with `Timestamp.now()` at the moment JS
 *     received them, not when the GPS fix was taken. Android delivers
 *     fixes collected while the WebView was throttled in a burst when it
 *     wakes; a 2 km gap "covered" in 40 ms looked like 180,000 km/h, got
 *     flagged as a glitch and excluded. We now carry the fix's own time.
 *  3. Stationary GPS jitter (5–40 m wobble every fix) was added as if it
 *     were travel, while long gaps were measured as a straight line —
 *     over-counting at stops and under-counting on the road at the same
 *     time, so the final number was unpredictable.
 *
 * The algorithm below fixes all three:
 *  - Distance is measured from the last *accepted* fix ("anchor"), never
 *    from a rejected one.
 *  - Speed checks use the GPS fix time.
 *  - Moves smaller than the combined accuracy radius are treated as noise
 *    (the anchor stays put, so slow real movement still accumulates).
 *  - Fixes with very poor accuracy are ignored for distance.
 *  - Long straight-line steps are reported as `gaps`, so the server can
 *    replace them with real road distance (see roadDistance.ts in
 *    functions) — a straight line between two points 2 km apart on a
 *    winding road can be 30–40% short.
 */

export const EARTH_RADIUS_METERS = 6371000

export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export interface DistancePoint {
  lat: number
  lng: number
  /** Epoch ms the GPS fix was taken (falls back to write time for old points). */
  tMs: number
  /** Accuracy radius in meters, if the device reported one. */
  accuracy: number | null
  /** Device-reported (Doppler) speed in km/h, if available — very reliable near zero. */
  speedKmh?: number | null
}

export interface DistanceOptions {
  /** Fixes with accuracy worse than this are ignored for distance. */
  maxAccuracyMeters: number
  /** Implied speed (between anchor and candidate) above this is a glitch. */
  implausibleSpeedKmh: number
  /** Floor for the jitter threshold. */
  minMoveMeters: number
  /** Ceiling for the jitter threshold, so bad accuracy can't swallow real driving. */
  maxJitterMeters: number
  /**
   * Jitter threshold = this × the two fixes' average accuracy radius. Two
   * independent fixes of a parked phone are on average ~1.2× the accuracy
   * radius apart, so 1.0× still lets a lot of noise through.
   */
  jitterAccuracyFactor: number
  /**
   * When the device itself reports a speed below this (km/h), a move of
   * up to 2× maxJitterMeters is treated as position drift, not travel.
   */
  stationarySpeedKmh: number
  /** Accuracy assumed when a fix didn't report one. */
  defaultAccuracyMeters: number
  /** A single accepted step at least this long is reported as a gap for road correction. */
  gapMeters: number
  /** After this many consecutive "glitches", assume the anchor itself was the outlier. */
  reanchorAfterRejects: number
}

export const DEFAULT_DISTANCE_OPTIONS: DistanceOptions = {
  maxAccuracyMeters: 100,
  implausibleSpeedKmh: 180,
  minMoveMeters: 8,
  maxJitterMeters: 50,
  jitterAccuracyFactor: 1.5,
  stationarySpeedKmh: 3,
  defaultAccuracyMeters: 15,
  gapMeters: 300,
  reanchorAfterRejects: 3,
}

/** One accepted movement between two point indexes. */
export interface DistanceStep {
  fromIdx: number
  toIdx: number
  meters: number
}

export interface DistanceResult {
  meters: number
  steps: DistanceStep[]
  /** Indexes rejected as implausible jumps (to be flagged needs_review). */
  glitchIdx: number[]
  /** Indexes ignored because their accuracy was too poor. */
  lowAccuracyIdx: number[]
}

export type StepVerdict =
  | { kind: 'accept'; meters: number }
  | { kind: 'jitter' }
  | { kind: 'glitch' }
  | { kind: 'low_accuracy' }

/**
 * Evaluates one candidate fix against the current anchor. Exported on its
 * own so the live (per-point) Cloud Function can apply exactly the same
 * rules incrementally as the batch computation does.
 */
export function evaluateStep(
  anchor: DistancePoint,
  candidate: DistancePoint,
  opts: DistanceOptions = DEFAULT_DISTANCE_OPTIONS
): StepVerdict {
  if (candidate.accuracy != null && candidate.accuracy > opts.maxAccuracyMeters) {
    return { kind: 'low_accuracy' }
  }
  const meters = haversineMeters(anchor.lat, anchor.lng, candidate.lat, candidate.lng)
  const seconds = (candidate.tMs - anchor.tMs) / 1000
  const speedKmh = seconds > 0 ? (meters / 1000) / (seconds / 3600) : meters > 50 ? Infinity : 0
  if (speedKmh > opts.implausibleSpeedKmh) return { kind: 'glitch' }

  const accA = anchor.accuracy ?? opts.defaultAccuracyMeters
  const accB = candidate.accuracy ?? opts.defaultAccuracyMeters
  const jitter = Math.min(
    opts.maxJitterMeters,
    Math.max(opts.minMoveMeters, ((accA + accB) / 2) * opts.jitterAccuracyFactor)
  )
  if (meters < jitter) return { kind: 'jitter' }
  if (
    candidate.speedKmh != null &&
    candidate.speedKmh >= 0 &&
    candidate.speedKmh < opts.stationarySpeedKmh &&
    meters < opts.maxJitterMeters * 2
  ) {
    return { kind: 'jitter' }
  }

  return { kind: 'accept', meters }
}

/**
 * Computes filtered distance over `points` (must already be sorted by
 * tMs). Returns every accepted step so callers can sum any sub-range
 * (route segments) with exactly the same filtering as the total.
 */
export function computeRouteDistance(
  points: DistancePoint[],
  opts: DistanceOptions = DEFAULT_DISTANCE_OPTIONS
): DistanceResult {
  const steps: DistanceStep[] = []
  const glitchIdx: number[] = []
  const lowAccuracyIdx: number[] = []
  let anchorIdx = -1
  let rejectStreak = 0

  for (let i = 0; i < points.length; i++) {
    const p = points[i]
    if (anchorIdx < 0) {
      if (p.accuracy != null && p.accuracy > opts.maxAccuracyMeters) {
        lowAccuracyIdx.push(i)
        continue
      }
      anchorIdx = i
      continue
    }
    const verdict = evaluateStep(points[anchorIdx], p, opts)
    switch (verdict.kind) {
      case 'low_accuracy':
        lowAccuracyIdx.push(i)
        break
      case 'jitter':
        rejectStreak = 0
        break
      case 'glitch':
        glitchIdx.push(i)
        rejectStreak++
        if (rejectStreak >= opts.reanchorAfterRejects) {
          // Several fixes in a row all disagree with the anchor (but, by
          // definition of reaching here, came in steadily) — the anchor
          // was the bad reading, not them. Restart from here.
          anchorIdx = i
          rejectStreak = 0
        }
        break
      case 'accept':
        steps.push({ fromIdx: anchorIdx, toIdx: i, meters: verdict.meters })
        anchorIdx = i
        rejectStreak = 0
        break
    }
  }

  return {
    meters: steps.reduce((sum, s) => sum + s.meters, 0),
    steps,
    glitchIdx,
    lowAccuracyIdx,
  }
}

/** Sums accepted steps that end inside (fromIdx, toIdx] — i.e. one route segment. */
export function sumSteps(steps: DistanceStep[], fromIdx: number, toIdx: number): number {
  let meters = 0
  for (const s of steps) {
    if (s.toIdx > fromIdx && s.toIdx <= toIdx) meters += s.meters
  }
  return meters
}

/** Helper: point time — prefers the GPS fix time, falls back to the write timestamp. */
export function pointTimeMs(p: { fixTimeMs?: number | null; timestamp: { toMillis(): number } }): number {
  return typeof p.fixTimeMs === 'number' && Number.isFinite(p.fixTimeMs) ? p.fixTimeMs : p.timestamp.toMillis()
}
