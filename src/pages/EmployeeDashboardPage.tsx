import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { useAuth } from '@/context/AuthContext'
import { useClock, formatDateIST, formatTimeIST } from '@/hooks/useClock'
import { useGeofenceStatus } from '@/hooks/useGeofenceStatus'
import { useAttendanceSession } from '@/hooks/useAttendanceSession'
import { useLiveTracking } from '@/hooks/useLiveTracking'
import { formatHours, computeElapsedHours } from '@/utils/hours'
import DashboardHeader from '@/components/DashboardHeader'
import EmployeeNavTabs from '@/components/EmployeeNavTabs'
import LocationStatusCard from '@/components/LocationStatusCard'
import LiveTrackingBanner from '@/components/LiveTrackingBanner'
import FaceCaptureModal from '@/components/FaceCaptureModal'

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return 'Something went wrong. Please try again.'
}

export default function EmployeeDashboardPage() {
  const { employee } = useAuth()
  const now = useClock()
  const { state: geofenceState, refresh: refreshLocation } =
    useGeofenceStatus(employee)
  const { activeLog, lastCompletedLog, loading, doPunchIn, doPunchOut } =
    useAttendanceSession(employee)
  // Phase T12: employeeId drives the hook's own offline-queue recovery
  // effect (independent of `activeLog` below, which only covers "still
  // punched in" — an employee can have already punched out, offline,
  // before the app was killed, in which case activeLog is null but there
  // may still be a session mid-way through a deferred close). The second
  // argument is deliberately `undefined` while attendance is still
  // loading, not `null` — see useLiveTracking's doc comment on why that
  // distinction avoids misclassifying a genuinely-active session as
  // abandoned during the moment right after this page mounts.
  const liveTracking = useLiveTracking(employee?.id ?? null, loading ? undefined : (activeLog?.id ?? null))
  const [actionLoading, setActionLoading] = useState(false)
  const [showFaceCapture, setShowFaceCapture] = useState(false)
  const [pendingCoords, setPendingCoords] = useState<{
    lat: number
    lng: number
  } | null>(null)

  // If the page loads (or refreshes) while already punched in, resume
  // into any existing active tracking session rather than losing it or
  // starting a duplicate. Deliberately does NOT start a brand-new
  // session here — that only happens on an actual Punch In action.
  useEffect(() => {
    if (employee && activeLog) {
      liveTracking.resumeIfActive(employee.id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employee, activeLog])

  async function handlePunchIn() {
    setActionLoading(true)
    try {
      const fresh = await refreshLocation()

      if (fresh.status === 'loading') {
        toast.error('Still checking your location. Please try again.')
        return
      }
      if (fresh.status === 'error') {
        toast.error(fresh.message)
        return
      }
      if (!fresh.withinRange) {
        toast.error('You are outside the permitted office location.')
        return
      }

      // Location verified — hand off to face capture. The actual
      // punchIn() write happens in handleFaceVerified() once the face
      // step succeeds.
      setPendingCoords({ lat: fresh.coords.lat, lng: fresh.coords.lng })
      setShowFaceCapture(true)
    } catch (error) {
      toast.error(extractErrorMessage(error))
    } finally {
      setActionLoading(false)
    }
  }

  async function handleFaceVerified() {
    if (!pendingCoords) {
      setShowFaceCapture(false)
      return
    }

    setActionLoading(true)
    try {
      const newLogId = await doPunchIn(pendingCoords.lat, pendingCoords.lng)
      toast.success('Punch In successful.')

      // Phase T14: pilot-rollout gate — an employee with tracking off
      // still punches in/out completely normally (see above), just never
      // gets a GPS session started. Deliberately checked here rather than
      // inside useLiveTracking itself: `resumeIfActive`'s recovery path
      // (this page's other effect) is intentionally NOT gated by this
      // flag, so a session already in progress when an admin flips this
      // off mid-shift still gets a chance to close out cleanly instead of
      // being abandoned.
      if (employee && employee.trackingEnabled) {
        liveTracking.start(employee.id, newLogId).catch((error) => {
          // Tracking failing to start shouldn't undo a successful punch
          // in — just log it. The employee's attendance is still valid.
          console.error('[EmployeeDashboardPage] Failed to start tracking:', error)
        })
      }
    } catch (error) {
      toast.error(extractErrorMessage(error))
    } finally {
      setActionLoading(false)
      setShowFaceCapture(false)
      setPendingCoords(null)
    }
  }

  function handleFaceCaptureCancel() {
    setShowFaceCapture(false)
    setPendingCoords(null)
  }

  async function handlePunchOut() {
    setActionLoading(true)
    try {
      const fresh = await refreshLocation()

      if (fresh.status === 'loading') {
        toast.error('Still checking your location. Please try again.')
        return
      }
      if (fresh.status === 'error') {
        toast.error(fresh.message)
        return
      }
      if (!fresh.withinRange) {
        toast.error('You are outside the permitted office location.')
        return
      }

      await doPunchOut(fresh.coords.lat, fresh.coords.lng)

      // Phase T12 follow-up: doPunchOut() now resolves as soon as the
      // punch-out is durably queued locally, before we know whether the
      // Firestore write actually landed — so the toast wording reflects
      // that rather than overclaiming. navigator.onLine is the same
      // best-effort signal useLiveTracking.ts already uses elsewhere.
      if (navigator.onLine) {
        toast.success('Punch Out successful.')
      } else {
        toast.success("Punch Out saved — it'll finish syncing once you're back online.")
      }

      liveTracking.stop().catch((error) => {
        console.error('[EmployeeDashboardPage] Failed to stop tracking:', error)
      })
    } catch (error) {
      toast.error(extractErrorMessage(error))
    } finally {
      setActionLoading(false)
    }
  }

  const isPunchedIn = !!activeLog
  const liveHours = activeLog
    ? computeElapsedHours(activeLog.loginTime.toDate(), now)
    : 0

  const displayedTotalHours = isPunchedIn
    ? liveHours
    : (lastCompletedLog?.totalHours ?? 0)
  const displayedOvertimeHours = isPunchedIn
    ? Math.max(liveHours - 8, 0)
    : (lastCompletedLog?.overtimeHours ?? 0)

  const punchInTimeLabel = activeLog
    ? formatTimeIST(activeLog.loginTime.toDate())
    : lastCompletedLog
      ? formatTimeIST(lastCompletedLog.loginTime.toDate())
      : 'Not punched in'

  const punchOutTimeLabel =
    lastCompletedLog && !isPunchedIn && lastCompletedLog.logoutTime
      ? formatTimeIST(lastCompletedLog.logoutTime.toDate())
      : '—'

  const buttonDisabled = loading || actionLoading

  return (
    <div className="min-h-screen bg-slate-50">
      <DashboardHeader />
      <EmployeeNavTabs />

      <main className="max-w-3xl mx-auto px-4 sm:px-6 pt-6 pb-24 sm:pb-6">
        <div className="rounded-2xl bg-white shadow-sm border border-slate-200 p-6">
          <h1 className="text-lg font-semibold text-slate-800">
            Today's Attendance
          </h1>

          <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <p className="text-sm text-slate-500">{formatDateIST(now)}</p>
            <p className="text-sm font-mono text-slate-700">
              {formatTimeIST(now)}
            </p>
          </div>

          <div className="mt-4">
            <LocationStatusCard
              state={geofenceState}
              onRetry={refreshLocation}
            />
          </div>

          {liveTracking.startedAt && (
            <div className="mt-4">
              <LiveTrackingBanner
                startedAt={liveTracking.startedAt}
                lastSyncAt={liveTracking.lastSyncAt}
                queuedCount={liveTracking.queuedCount}
                isFinalizingSync={liveTracking.isFinalizingSync}
              />
            </div>
          )}

          <dl className="mt-6 grid grid-cols-2 gap-4">
            <div className="rounded-lg bg-slate-50 px-4 py-3">
              <dt className="text-xs text-slate-400">Punch In</dt>
              <dd className="mt-1 text-sm font-medium text-slate-700">
                {punchInTimeLabel}
              </dd>
            </div>
            <div className="rounded-lg bg-slate-50 px-4 py-3">
              <dt className="text-xs text-slate-400">Punch Out</dt>
              <dd className="mt-1 text-sm font-medium text-slate-700">
                {punchOutTimeLabel}
              </dd>
            </div>
            <div className="rounded-lg bg-slate-50 px-4 py-3">
              <dt className="text-xs text-slate-400">Working Hours</dt>
              <dd className="mt-1 text-sm font-medium text-slate-700">
                {formatHours(displayedTotalHours)}
              </dd>
            </div>
            <div className="rounded-lg bg-slate-50 px-4 py-3">
              <dt className="text-xs text-slate-400">Overtime</dt>
              <dd className="mt-1 text-sm font-medium text-slate-700">
                {formatHours(displayedOvertimeHours)}
              </dd>
            </div>
          </dl>

          {isPunchedIn ? (
            <button
              onClick={handlePunchOut}
              disabled={buttonDisabled}
              className="mt-6 w-full rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-semibold py-3 transition-colors"
            >
              {actionLoading ? 'Processing…' : 'PUNCH OUT'}
            </button>
          ) : (
            <button
              onClick={handlePunchIn}
              disabled={buttonDisabled}
              className="mt-6 w-full rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-semibold py-3 transition-colors"
            >
              {actionLoading ? 'Processing…' : 'PUNCH IN'}
            </button>
          )}
        </div>
      </main>

      {showFaceCapture && (
        <FaceCaptureModal
          onVerified={handleFaceVerified}
          onCancel={handleFaceCaptureCancel}
        />
      )}
    </div>
  )
}
