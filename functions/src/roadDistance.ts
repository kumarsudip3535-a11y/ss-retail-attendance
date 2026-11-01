import { logger } from 'firebase-functions'
import { sleep } from './geocode'
import type { DistancePoint, DistanceStep } from './routeDistance'

/**
 * Phase T2 distance fix — road-distance correction for long straight-line
 * steps.
 *
 * GPS distance is a chain of straight lines between fixes. When fixes are
 * close together that's accurate, but whenever there's a long step (screen
 * was off and Android throttled the app, GPS lost signal in a flyover or
 * tunnel, low-battery interval) the straight line cuts every corner — this
 * was a big part of a 20 km ride showing far less.
 *
 * For each long step we ask an OSRM router for the real driving distance
 * between its two ends, and use it when it's plausible (never shorter than
 * the straight line, never absurdly longer, and drivable in the time that
 * actually elapsed). Several steps are batched into one request: the
 * coordinates are sent as a1;b1;a2;b2;… and only the a→b legs are used.
 *
 * The default endpoint is OSRM's free public demo server — fine for a
 * pilot, but it has a fair-use policy (≈1 req/s, no SLA). For production
 * self-host OSRM or point `osrmBaseUrl` (trackingConfig/default) at a
 * hosted provider with the same API. Any failure falls back silently to
 * the straight-line value — never fatal to aggregation.
 */

export interface RoadCorrectionOptions {
  enabled: boolean
  osrmBaseUrl: string
  /**
   * Road distance may be at most this multiple of the straight line for
   * long steps (≥ 1 km). Short steps get a tighter 1.5× cap: on divided
   * roads OSRM can snap one end to the opposite carriageway and add a
   * U-turn detour, which would over-count.
   */
  maxDetourRatio: number
  /** Cap on how many steps are corrected per session (keeps the public server happy). */
  maxCorrectionsPerSession: number
  /** Only steps at least this long are considered. */
  gapMeters: number
  implausibleSpeedKmh: number
}

const PAIRS_PER_REQUEST = 40 // 80 coordinates — well under OSRM's default limits

interface OsrmRouteResponse {
  code: string
  routes?: { legs: { distance: number }[] }[]
}

/**
 * Returns a copy of `steps` with long steps' meters replaced by road
 * distance where available, plus how many steps were corrected.
 */
export async function applyRoadCorrection(
  points: DistancePoint[],
  steps: DistanceStep[],
  opts: RoadCorrectionOptions
): Promise<{ steps: DistanceStep[]; corrected: number; addedMeters: number }> {
  const out = steps.map((s) => ({ ...s }))
  if (!opts.enabled) return { steps: out, corrected: 0, addedMeters: 0 }

  const candidates = out
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.meters >= opts.gapMeters)
    .sort((a, b) => b.s.meters - a.s.meters) // longest first — biggest error
    .slice(0, opts.maxCorrectionsPerSession)
    .sort((a, b) => a.i - b.i)

  let corrected = 0
  let addedMeters = 0

  for (let c = 0; c < candidates.length; c += PAIRS_PER_REQUEST) {
    const chunk = candidates.slice(c, c + PAIRS_PER_REQUEST)
    const coords = chunk
      .flatMap(({ s }) => [points[s.fromIdx], points[s.toIdx]])
      .map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`)
      .join(';')
    const url = `${opts.osrmBaseUrl.replace(/\/$/, '')}/route/v1/driving/${coords}?overview=false&steps=false`

    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'ss-retail-attendance-tracking/1.0 (route distance)' },
        signal: AbortSignal.timeout(15000),
      })
      if (!response.ok) {
        logger.warn(`[roadDistance] OSRM HTTP ${response.status} — keeping straight-line distance for ${chunk.length} step(s).`)
        continue
      }
      const data = (await response.json()) as OsrmRouteResponse
      const legs = data.code === 'Ok' ? data.routes?.[0]?.legs : undefined
      if (!legs || legs.length !== chunk.length * 2 - 1) {
        logger.warn(`[roadDistance] Unexpected OSRM response (${data.code}) — keeping straight-line distance.`)
        continue
      }
      chunk.forEach(({ s, i }, k) => {
        const road = legs[k * 2].distance // a_k -> b_k
        const from = points[s.fromIdx]
        const to = points[s.toIdx]
        const hours = (to.tMs - from.tMs) / 3_600_000
        const roadSpeedKmh = hours > 0 ? road / 1000 / hours : Infinity
        const plausible =
          Number.isFinite(road) &&
          road >= s.meters &&
          road <= s.meters * (s.meters < 1000 ? Math.min(1.5, opts.maxDetourRatio) : opts.maxDetourRatio) &&
          roadSpeedKmh <= opts.implausibleSpeedKmh
        if (plausible) {
          addedMeters += road - s.meters
          out[i].meters = road
          corrected++
        }
      })
    } catch (error) {
      logger.warn('[roadDistance] OSRM request failed — keeping straight-line distance:', error)
    }
    if (c + PAIRS_PER_REQUEST < candidates.length) await sleep(1100)
  }

  return { steps: out, corrected, addedMeters }
}
