/**
 * Best-effort reverse geocoding via OpenStreetMap Nominatim (no API key,
 * free tier) — see the roadmap doc, "Geocoding" decision. Nominatim's
 * usage policy caps requests at ~1/sec and requires an identifying
 * User-Agent, so callers MUST await sleep() between calls when geocoding
 * more than one point in a single function invocation.
 *
 * Failure here is never fatal to the aggregation pipeline — a stop or
 * segment with address: null is still fully usable, just without a
 * human-readable label. Swap this out for Google/Mapbox geocoding later
 * by changing only this file.
 */

const NOMINATIM_ENDPOINT = 'https://nominatim.openstreetmap.org/reverse'
const USER_AGENT = 'ss-retail-attendance-tracking/1.0 (field-staff route aggregation)'

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  try {
    const url = `${NOMINATIM_ENDPOINT}?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=0`
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    })

    if (!response.ok) return null

    const data = (await response.json()) as { display_name?: string }
    return data.display_name ?? null
  } catch (error) {
    console.warn(`[geocode] Reverse geocode failed for ${lat},${lng}:`, error)
    return null
  }
}
