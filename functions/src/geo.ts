/**
 * Self-contained copy of the Haversine formula used client-side in
 * src/services/locationService.ts. Cloud Functions is a separate npm
 * package from the frontend (no shared build step between them), so this
 * is intentionally duplicated rather than imported — keep both in sync if
 * the formula ever changes.
 */
const EARTH_RADIUS_METERS = 6371000

export function haversineDistanceMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180

  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

  return EARTH_RADIUS_METERS * c
}

/** Same distance, in kilometers, rounded to 3 decimal places. */
export function haversineDistanceKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  return Math.round((haversineDistanceMeters(lat1, lng1, lat2, lng2) / 1000) * 1000) / 1000
}

/**
 * Formats a Date as a yyyy-MM-dd key in Asia/Kolkata local time, regardless
 * of the server's own timezone (Cloud Functions run in UTC). This matches
 * how the frontend displays dates via formatDateIST (src/hooks/useClock.ts)
 * so a "day" means the same thing on both sides of the app.
 */
const istDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

export function toISTDateKey(date: Date): string {
  // en-CA locale formats as yyyy-MM-dd directly.
  return istDateFormatter.format(date)
}

/** Start/end of the IST calendar day (as UTC instants) containing `date`. */
export function istDayRange(date: Date): { from: Date; to: Date } {
  const dateKey = toISTDateKey(date) // yyyy-MM-dd
  // IST is UTC+5:30 with no DST — midnight IST on dateKey is
  // (dateKey)T00:00:00+05:30, which we can express directly.
  const from = new Date(`${dateKey}T00:00:00.000+05:30`)
  const to = new Date(`${dateKey}T23:59:59.999+05:30`)
  return { from, to }
}
