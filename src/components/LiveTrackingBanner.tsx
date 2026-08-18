import { formatTimeIST } from '@/hooks/useClock'

interface LiveTrackingBannerProps {
  startedAt: Date | null
  lastSyncAt: Date | null
  queuedCount: number
  /**
   * Phase T12: true once punch-out has been requested but the offline
   * queue hasn't fully synced yet — collection has stopped, this is
   * purely "still uploading what was already captured" before today's
   * shift can actually close out.
   */
  isFinalizingSync?: boolean
}

/**
 * Always-visible indicator that location tracking is active — required
 * by spec section 27 (privacy). Employees must never be tracked without
 * clearly seeing that it's happening, when it started, and when it last
 * synced. Also covers Phase T12's "finishing sync after punch-out" state,
 * so a large offline queue doesn't just silently vanish from view the
 * moment PUNCH OUT is pressed.
 */
export default function LiveTrackingBanner({
  startedAt,
  lastSyncAt,
  queuedCount,
  isFinalizingSync = false,
}: LiveTrackingBannerProps) {
  if (!startedAt) return null

  if (isFinalizingSync) {
    return (
      <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 flex items-start gap-3">
        <span className="mt-1 h-2 w-2 rounded-full bg-amber-500 animate-pulse shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-amber-700">FINISHING SYNC</p>
          <p className="text-xs text-amber-600 mt-0.5">
            {queuedCount} point{queuedCount === 1 ? '' : 's'} still uploading from today's shift — keep the app
            open or connected until this clears.
          </p>
          <p className="text-xs text-amber-500 mt-0.5">
            Today's shift will finish closing out automatically once everything syncs, even if you close the app
            now — nothing is lost.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-3 flex items-start gap-3">
      <span className="mt-1 h-2 w-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
      <div className="min-w-0">
        <p className="text-sm font-semibold text-emerald-700">
          LIVE TRACKING ACTIVE
        </p>
        <p className="text-xs text-emerald-600 mt-0.5">
          Started {formatTimeIST(startedAt)}
          {lastSyncAt && <> · Last synced {formatTimeIST(lastSyncAt)}</>}
          {queuedCount > 0 && (
            <> · {queuedCount} point{queuedCount === 1 ? '' : 's'} queued (offline)</>
          )}
        </p>
        <p className="text-xs text-emerald-500 mt-0.5">
          Your location is recorded only while punched in, for route and
          travel-expense verification.
        </p>
      </div>
    </div>
  )
}
