import { useCallback, useEffect, useState } from 'react'
import { getCurrentPosition, checkGeofence } from '@/services/locationService'
import type { Employee, LocationCoords } from '@/types'

export type GeofenceState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'ready'
      coords: LocationCoords
      distanceMeters: number
      allowedRadiusMeters: number
      withinRange: boolean
    }

/**
 * Fetches the browser's current position and checks it against the given
 * employee's geofence, exposing a single state machine the dashboard UI
 * can render directly. Call refresh() to re-check (e.g. right before a
 * punch in/out action, since location can go stale).
 */
export function useGeofenceStatus(employee: Employee | null) {
  const [state, setState] = useState<GeofenceState>({ status: 'loading' })

  const refresh = useCallback(async (): Promise<GeofenceState> => {
    if (!employee) {
      const errorState: GeofenceState = {
        status: 'error',
        message: 'No employee record available.',
      }
      setState(errorState)
      return errorState
    }

    setState({ status: 'loading' })

    const result = await getCurrentPosition()
    if (!result.success) {
      const errorState: GeofenceState = {
        status: 'error',
        message: result.message,
      }
      setState(errorState)
      return errorState
    }

    try {
      const geofence = checkGeofence(
        result.coords.lat,
        result.coords.lng,
        employee.officeLat,
        employee.officeLng,
        employee.geofenceRadius
      )
      const readyState: GeofenceState = {
        status: 'ready',
        coords: result.coords,
        distanceMeters: geofence.distanceMeters,
        allowedRadiusMeters: geofence.allowedRadiusMeters,
        withinRange: geofence.withinRange,
      }
      setState(readyState)
      return readyState
    } catch (error) {
      const errorState: GeofenceState = {
        status: 'error',
        message:
          error instanceof Error
            ? error.message
            : 'Unable to verify office location for this employee.',
      }
      setState(errorState)
      return errorState
    }
  }, [employee])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { state, refresh }
}
