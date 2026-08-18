import { useCallback, useEffect, useState } from 'react'
import { Timestamp } from 'firebase/firestore'
import {
  getActiveSession,
  punchIn as punchInService,
  computePunchOut,
  writePunchOut,
  flushPendingPunchOut,
} from '@/services/attendanceService'
import {
  setPendingPunchOut,
  getPendingPunchOut,
  type PendingPunchOut,
} from '@/utils/offlineQueueDb'
import type { AttendanceLog, Employee } from '@/types'

interface AttendanceSessionState {
  /** The current open (not yet punched out) session, if any */
  activeLog: AttendanceLog | null
  /** The most recently completed session, shown after punching out */
  lastCompletedLog: AttendanceLog | null
  loading: boolean
}

/** Reconstructs the AttendanceLog shape the UI expects from a durably-queued punch-out, with no network read — see offlineQueueDb.ts's module doc comment. */
function pendingToAttendanceLog(pending: PendingPunchOut): AttendanceLog {
  return {
    id: pending.attendanceLogId,
    employeeId: pending.employeeId,
    loginTime: Timestamp.fromMillis(pending.loginTimeMs),
    loginLat: pending.loginLat,
    loginLng: pending.loginLng,
    logoutTime: Timestamp.fromMillis(pending.logoutTimestampMs),
    logoutLat: pending.logoutLat,
    logoutLng: pending.logoutLng,
    totalHours: pending.totalHours,
    overtimeHours: pending.overtimeHours,
  }
}

/**
 * Tracks the employee's attendance session for today and exposes
 * punchIn/punchOut actions that write to Firestore via attendanceService.
 * UI components call these and catch errors to show toasts — the hook
 * itself doesn't show any UI.
 *
 * Phase T12 follow-up: Punch Out is durable-first (see doPunchOut below)
 * rather than a direct blocking Firestore write — live testing of T12
 * found that a direct write hangs indefinitely while offline instead of
 * failing fast, which froze the UI and also meant useLiveTracking's stop()
 * (called after doPunchOut resolves) could never run while genuinely
 * offline, making its own deferred-close path unreachable in practice.
 */
export function useAttendanceSession(employee: Employee | null) {
  const [state, setState] = useState<AttendanceSessionState>({
    activeLog: null,
    lastCompletedLog: null,
    loading: true,
  })

  const refresh = useCallback(async () => {
    if (!employee) {
      setState({ activeLog: null, lastCompletedLog: null, loading: false })
      return
    }

    setState((prev) => ({ ...prev, loading: true }))

    // A pending punch-out (durable, local) means the employee already
    // ended their shift — possibly while offline — before this load.
    // Reading it is a fast local IndexedDB lookup, never a network call,
    // so this can't hang the way the old unconditional getActiveSession()
    // read could if it happened to run while offline right after an
    // offline Punch Out. Show the punched-out state immediately and let
    // the flush below finish writing it to Firestore whenever
    // connectivity allows.
    const pending = await getPendingPunchOut(employee.id)
    if (pending) {
      setState({
        activeLog: null,
        lastCompletedLog: pendingToAttendanceLog(pending),
        loading: false,
      })
      flushPendingPunchOut(employee.id).catch((error) => {
        console.error('[useAttendanceSession] Deferred punch-out flush failed:', error)
      })
      return
    }

    const active = await getActiveSession(employee.id)
    setState((prev) => ({ ...prev, activeLog: active, loading: false }))
  }, [employee])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Retry a still-pending punch-out as soon as the browser reports
  // connectivity back — mirrors the same 'online' listener pattern
  // useLiveTracking.ts uses for its own offline queue.
  useEffect(() => {
    if (!employee) return
    const currentEmployeeId = employee.id
    function handleOnline() {
      flushPendingPunchOut(currentEmployeeId)
        .then((flushed) => {
          if (flushed) refresh()
        })
        .catch((error) =>
          console.error('[useAttendanceSession] Online punch-out flush failed:', error)
        )
    }
    window.addEventListener('online', handleOnline)
    return () => window.removeEventListener('online', handleOnline)
  }, [employee, refresh])

  /**
   * Throws on failure (e.g. duplicate session) — caller should catch and
   * toast. Returns the new attendanceLogs document ID (used by the Live
   * Tracking module to link a tracking session to this punch-in).
   */
  async function doPunchIn(lat: number, lng: number): Promise<string> {
    if (!employee) throw new Error('No employee record available.')
    const newLogId = await punchInService(employee.id, lat, lng)
    await refresh()
    return newLogId
  }

  /**
   * Ends the active session. Durable-first: the punch-out is computed
   * entirely client-side and persisted to IndexedDB before any network
   * write is attempted, so this resolves immediately regardless of
   * connectivity — it can never hang the UI the way a direct offline
   * Firestore write did. The actual write happens in the background
   * (fire-and-forget here) and is retried automatically on reconnect via
   * the 'online' listener above, or on the next app load via refresh()'s
   * pending-punch-out check. Throws only for genuinely local reasons (no
   * employee, no active session, or IndexedDB itself unavailable) —
   * caller should catch and toast.
   */
  async function doPunchOut(lat: number, lng: number): Promise<AttendanceLog> {
    if (!employee) throw new Error('No employee record available.')
    if (!state.activeLog) throw new Error('No active attendance session found.')

    const computation = computePunchOut(state.activeLog, lat, lng)

    try {
      await setPendingPunchOut(computation)
    } catch (error) {
      // IndexedDB itself is unavailable (very old browser / locked-down
      // private-browsing mode) — extremely rare, but silently proceeding
      // here would clear the employee's punched-in state with no durable
      // record at all if the network write below also fails. Fall back to
      // the direct blocking write instead: same risk profile as before
      // this fix (can hang while offline), but strictly better than
      // losing a payroll-relevant punch-out outright.
      console.error('[useAttendanceSession] Durable punch-out queue unavailable, falling back to direct write:', error)
      await writePunchOut(computation)
      const completed = pendingToAttendanceLog(computation)
      setState({ activeLog: null, lastCompletedLog: completed, loading: false })
      return completed
    }

    const completed = pendingToAttendanceLog(computation)
    setState({ activeLog: null, lastCompletedLog: completed, loading: false })

    flushPendingPunchOut(employee.id).catch((error) => {
      console.error('[useAttendanceSession] Punch-out flush failed:', error)
    })

    return completed
  }

  return { ...state, refresh, doPunchIn, doPunchOut }
}
