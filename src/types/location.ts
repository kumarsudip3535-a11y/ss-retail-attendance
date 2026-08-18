export type LocationErrorCode =
  | 'permission_denied'
  | 'position_unavailable'
  | 'timeout'
  | 'unsupported'
  | 'unknown'

export interface LocationCoords {
  lat: number
  lng: number
  /** GPS accuracy radius in meters, if provided by the browser */
  accuracy?: number
}

export type LocationResult =
  | { success: true; coords: LocationCoords }
  | { success: false; errorCode: LocationErrorCode; message: string }

export interface GeofenceCheck {
  withinRange: boolean
  distanceMeters: number
  allowedRadiusMeters: number
}
