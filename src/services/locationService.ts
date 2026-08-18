import type {
  GeofenceCheck,
  LocationCoords,
  LocationErrorCode,
  LocationResult,
} from '@/types'

const EARTH_RADIUS_METERS = 6371000

/**
 * Distance between two lat/lng points using the Haversine formula.
 * Returns meters.
 */
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

/**
 * Checks whether a given position falls within an office's geofence.
 * Guards against invalid office coordinates (0,0 / NaN / missing radius)
 * rather than silently allowing or blocking attendance.
 */
export function checkGeofence(
  currentLat: number,
  currentLng: number,
  officeLat: number,
  officeLng: number,
  geofenceRadius: number
): GeofenceCheck {
  const hasValidOfficeCoords =
    Number.isFinite(officeLat) &&
    Number.isFinite(officeLng) &&
    !(officeLat === 0 && officeLng === 0) &&
    Number.isFinite(geofenceRadius) &&
    geofenceRadius > 0

  if (!hasValidOfficeCoords) {
    throw new Error(
      'Invalid office coordinates or geofence radius for this employee.'
    )
  }

  const distanceMeters = haversineDistanceMeters(
    currentLat,
    currentLng,
    officeLat,
    officeLng
  )

  return {
    withinRange: distanceMeters <= geofenceRadius,
    distanceMeters,
    allowedRadiusMeters: geofenceRadius,
  }
}

function mapGeolocationError(error: GeolocationPositionError): {
  errorCode: LocationErrorCode
  message: string
} {
  switch (error.code) {
    case error.PERMISSION_DENIED:
      return {
        errorCode: 'permission_denied',
        message: 'Location permission is required to mark attendance.',
      }
    case error.POSITION_UNAVAILABLE:
      return {
        errorCode: 'position_unavailable',
        message: 'Unable to determine your current location.',
      }
    case error.TIMEOUT:
      return {
        errorCode: 'timeout',
        message: 'Location request timed out. Please try again.',
      }
    default:
      return {
        errorCode: 'unknown',
        message: 'Something went wrong while getting your location.',
      }
  }
}

/**
 * Wraps the browser Geolocation API in a Promise and normalizes every
 * failure mode (unsupported browser, permission denied, GPS unavailable,
 * timeout) into a single LocationResult shape the UI can branch on.
 */
export function getCurrentPosition(
  options: PositionOptions = {
    enableHighAccuracy: true,
    timeout: 15000,
    maximumAge: 0,
  }
): Promise<LocationResult> {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) {
      resolve({
        success: false,
        errorCode: 'unsupported',
        message: 'Your browser does not support location services.',
      })
      return
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const coords: LocationCoords = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
        }
        resolve({ success: true, coords })
      },
      (error) => {
        const { errorCode, message } = mapGeolocationError(error)
        resolve({ success: false, errorCode, message })
      },
      options
    )
  })
}
