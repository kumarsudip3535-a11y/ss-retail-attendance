import { useCallback, useEffect, useRef, useState } from 'react'
import { Timestamp } from 'firebase/firestore'
import toast from 'react-hot-toast'
import {
  startTrackingSession,
  endTrackingSession,
  getActiveTrackingSession,
  getTrackingSessionStatus,
  recordLocationPoint,
} from '@/services/trackingService'
import {
  enqueuePoint,
  getQueuedPoints,
  removeQueuedPoint,
  countQueuedPoints,
  getSessionIdsWithQueuedPoints,
  setPendingClose,
  getPendingClose,
  clearPendingClose,
  getPendingCloseSessionIds,
  type PendingPoint,
} from '@/utils/offlineQueueDb'
import { withConnectionRetry, isPermissionDenied } from '@/utils/firestoreResilience'
import type { LocationPointQuality, NetworkStatus } from '@/types'

/** Normal collection interval while battery is healthy. */
const BASE_INTERVAL_MS = 60_000 // 60s
/** Wider interval once battery drops below the threshold, to conserve it. */
const LOW_BATTERY_INTERVAL_MS = 180_000 // 3 min
const LOW_BATTERY_THRESHOLD_PERCENT = 20
/** Accuracy readings worse than this (meters) get flagged, not discarded. */
const LOW_ACCURACY_THRESHOLD_METERS = 100

interface UseLiveTrackingResult {
  isTracking: boolean
  sessionId: string | null
  startedAt: Date | null
  lastSyncAt: Date | null
  /** Points collected while offline, not yet written to Firestore — now backed by IndexedDB, see offlineQueueDb.ts. */
  queuedCount: number
  /**
   * Phase T12: true once punch-out has been requested but the offline
   * queue hasn't fully drained yet, so the actual Firestore session close
   * is deferred. Collection has stopped (isTracking is false) — this is
   * purely "still uploading what was already captured."
   */
  isFinalizingSync: boolean
  /** Starts a new session tied to a fresh punch-in. */
  start: (employeeId: string, attendanceLogId: string) => Promise<void>
  /** Ends the current session (called on punch-out) — see doc comment on `stop` below for the deferred-close behavior. */
  stop: () => Promise<void>
  /**
   * Checks for (and resumes into) an already-active session for this
   * employee — used on page load so a refresh mid-shift doesn't lose
   * tracking or start a duplicate session.
   */
  resumeIfActive: (employeeId: string) => Promise<void>
}

// Phase T12: several independent triggers can all try to flush the same
// session around the same time (collectPoint's pre-write flush, the
// 'online' listener, resumeIfActive, the recovery effect) — without a
// guard, two concurrent calls can both read the same still-queued point
// from IndexedDB before either has deleted it, writing it to Firestore
// twice. A same-tab, per-session in-memory lock is enough here (it's the
// concurrent-read-before-delete race within one tab this closes, not
// cross-tab/cross-device duplication).
const flushesInProgress = new Set<string>()

/**
 * Flushes one session's persisted offline queue, oldest point first,
 * stopping at the first failure (still offline/flaky — better to retry
 * the whole remaining batch later than hammer a bad connection). Pure
 * module-level helper (no component state) so it's safely reusable from
 * both the live hot path and the background recovery pass below.
 */
async function flushSessionQueue(sessionId: string): Promise<number> {
  if (flushesInProgress.has(sessionId)) {
    // Another flush for this session is already in flight — report the
    // current count rather than racing it; the in-flight call will
    // finish the job.
    return countQueuedPoints(sessionId)
  }
  flushesInProgress.add(sessionId)
  try {
    const queued = await getQueuedPoints(sessionId)
    let remaining = queued.length
    // Looked up at most once per flush pass, only if/when a point in this
    // batch actually hits permission-denied — every point here shares the
    // same trackingSessionId, so the session's active/completed status
    // can't change from one point to the next within a single pass, and
    // the common case (session still active, writes just succeed) never
    // pays for this extra read at all.
    let sessionStatus: Awaited<ReturnType<typeof getTrackingSessionStatus>> | undefined
    for (const { localId, point } of queued) {
      // Live-tested finding (Phase T12 follow-up, same root cause as the
      // Punch Out hang): this project's Firestore writes don't reject
      // when offline, they queue internally and leave the promise pending
      // until connectivity returns. Without this check, awaiting
      // recordLocationPoint() here while offline would hang this entire
      // flush — and, when flushSessionQueue is called from stop(), that
      // hang would block stop() from ever reaching the deferred-close
      // branch, leaving the banner frozen instead of switching to
      // "FINISHING SYNC". Checking navigator.onLine first (the same guard
      // collectPoint already uses) makes "can't currently write" fail
      // fast instead of hanging.
      if (!navigator.onLine) break
      try {
        // Phase T13: wrapped in withConnectionRetry — a wedged Firestore
        // connection (see firestoreResilience.ts) surfaces here as
        // permission-denied on an otherwise-valid, online write. One
        // connection reset + retry recovers it without needing a page
        // reload; any other failure still breaks the loop as before.
        await withConnectionRetry(() => recordLocationPoint(point))
        await removeQueuedPoint(localId)
        remaining--
      } catch (error) {
        // Phase T13 follow-up: a permission-denied that survives
        // withConnectionRetry's reset+retry isn't always a wedged
        // connection — firestore.rules only allows writing a
        // locationPoint into a still-*active* session, so a point whose
        // session has since been closed (e.g. force-closed by a recovery
        // pass, or by an admin, while this point was still offline-queued
        // elsewhere) will be denied forever, no matter how many times we
        // retry it. Confirm that's actually what happened before giving
        // up on it — don't just assume — then drop it and move on to the
        // rest of the batch instead of getting stuck retrying an
        // unwritable point on every future flush.
        if (isPermissionDenied(error)) {
          if (sessionStatus === undefined) {
            sessionStatus = await getTrackingSessionStatus(sessionId).catch(() => null)
          }
          if (sessionStatus !== 'active') {
            console.warn(
              `[useLiveTracking] Dropping a queued point — its session (${sessionId}) is no longer active, so this point can never be written.`
            )
            await removeQueuedPoint(localId)
            remaining--
            continue
          }
        }
        console.error('[useLiveTracking] Failed to flush queued point:', error)
        break
      }
    }
    return remaining
  } finally {
    flushesInProgress.delete(sessionId)
  }
}

/**
 * If a session has a pending-close marker and its queue is now fully
 * drained, actually closes it (the deferred half of `stop()` below).
 * Returns true if it closed the session.
 */
async function maybeFinalizeClose(sessionId: string): Promise<boolean> {
  const pending = await getPendingClose(sessionId)
  if (!pending) return false
  const remaining = await countQueuedPoints(sessionId)
  if (remaining > 0) return false
  // Same fast-fail-instead-of-hang reasoning as flushSessionQueue above:
  // an empty queue doesn't mean it's safe to write — we could be offline
  // with nothing queued (e.g. everything synced right before the
  // connection dropped again). Don't attempt endTrackingSession() at all
  // in that case; leave the pendingClose marker for the next retry.
  if (!navigator.onLine) return false
  try {
    // Phase T13: see the matching comment in flushSessionQueue above —
    // same wedged-connection risk applies to the session-close write.
    await withConnectionRetry(() => endTrackingSession(sessionId))
    await clearPendingClose(sessionId)
    return true
  } catch (error) {
    console.error('[useLiveTracking] Failed to finalize a deferred session close:', error)
    return false
  }
}

/**
 * Phase T12: drains any offline queue / pending-close left over from a
 * session other than the one this hook instance is actively driving right
 * now — covers the app being killed at any point (mid-collection,
 * mid-flush, or between the flush finishing and the close write landing),
 * possibly days before this reload. Deliberately silent-then-toast rather
 * than wired into the persistent LiveTrackingBanner: these are, by
 * definition, sessions nothing in the *current* screen is showing.
 */
async function recoverOrphanedSessions(
  employeeId: string,
  skipSessionId: string | null,
  // undefined = attendance status not loaded yet this pass — deliberately
  // distinct from null ("confirmed not punched in"), so a race where this
  // recovery effect fires before useAttendanceSession's own fetch
  // resolves can't misclassify a genuinely-active session as abandoned.
  currentAttendanceLogId: string | null | undefined
): Promise<{ pointsRecovered: number; sessionsClosed: number }> {
  const [queuedSessionIds, pendingCloseSessionIds] = await Promise.all([
    getSessionIdsWithQueuedPoints(employeeId),
    getPendingCloseSessionIds(employeeId),
  ])
  const sessionIds = new Set([...queuedSessionIds, ...pendingCloseSessionIds])

  // Phase T12: also catch a session left Firestore-active with NEITHER a
  // queued point NOR a pendingClose marker — the narrow window where
  // punch-out's attendance write succeeded but the app was killed before
  // `stop()` itself ever ran, so nothing local ever recorded that this
  // shift had actually ended. Only treat it as abandoned if it doesn't
  // belong to whatever attendance record is genuinely still open right
  // now (that's resumeIfActive's job, not recovery's) — and only once
  // attendance status is actually known.
  const stillActive = currentAttendanceLogId !== undefined ? await getActiveTrackingSession(employeeId) : null
  const isAbandoned =
    !!stillActive && stillActive.id !== skipSessionId && stillActive.attendanceLogId !== currentAttendanceLogId
  if (stillActive && isAbandoned) sessionIds.add(stillActive.id)

  let pointsRecovered = 0
  let sessionsClosed = 0

  for (const sid of sessionIds.values()) {
    if (sid === skipSessionId) continue
    const before = await countQueuedPoints(sid)
    const remaining = await flushSessionQueue(sid)
    pointsRecovered += before - remaining

    if (remaining === 0 && isAbandoned && stillActive?.id === sid && !(await getPendingClose(sid))) {
      // Discovered abandoned via the direct Firestore check, not via a
      // pendingClose marker (stop() never ran) — set one now so
      // maybeFinalizeClose below actually closes it.
      await setPendingClose(sid, employeeId)
    }

    if (await maybeFinalizeClose(sid)) sessionsClosed++
  }

  return { pointsRecovered, sessionsClosed }
}

/**
 * Drives GPS collection while an employee is on field duty. Interval
 * adapts to battery level; readings taken while offline are queued
 * durably (IndexedDB, Phase T12) and flushed once connectivity returns —
 * including across a full app/tab kill, not just within the same session.
 */
export function useLiveTracking(
  employeeId: string | null,
  // Pass undefined while the caller's own attendance fetch is still
  // loading, null once confirmed not punched in, or the active log's ID
  // once confirmed punched in — see recoverOrphanedSessions's doc comment
  // for why the undefined case matters.
  activeAttendanceLogId: string | null | undefined = undefined
): UseLiveTrackingResult {
  const [isTracking, setIsTracking] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [startedAt, setStartedAt] = useState<Date | null>(null)
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null)
  const [queuedCount, setQueuedCount] = useState(0)
  const [isFinalizingSync, setIsFinalizingSync] = useState(false)

  const employeeIdRef = useRef<string | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const timeoutRef = useRef<number | null>(null)
  const batteryPercentRef = useRef<number | null>(null)

  // Best-effort battery monitoring — the Battery Status API isn't
  // available in every browser, so this degrades gracefully to "always
  // use the normal interval" when it's missing.
  useEffect(() => {
    let battery: (EventTarget & { level: number }) | null = null
    let onLevelChange: (() => void) | null = null

    const nav = navigator as Navigator & {
      getBattery?: () => Promise<EventTarget & { level: number }>
    }

    if (nav.getBattery) {
      nav
        .getBattery()
        .then((b) => {
          battery = b
          batteryPercentRef.current = Math.round(b.level * 100)
          onLevelChange = () => {
            batteryPercentRef.current = Math.round(b.level * 100)
          }
          b.addEventListener('levelchange', onLevelChange)
        })
        .catch(() => {
          // Battery API present but denied/unsupported — fine, just skip.
        })
    }

    return () => {
      if (battery && onLevelChange) {
        battery.removeEventListener('levelchange', onLevelChange)
      }
    }
  }, [])

  /** Flushes the CURRENT session's queue and reflects the result in state — the live-hook-instance counterpart to the module-level flushSessionQueue helper. */
  const flushOfflineQueue = useCallback(async () => {
    const sid = sessionIdRef.current
    if (!sid) return
    const remaining = await flushSessionQueue(sid)
    setQueuedCount(remaining)

    if (remaining === 0 && (await maybeFinalizeClose(sid))) {
      if (sessionIdRef.current === sid) {
        sessionIdRef.current = null
        employeeIdRef.current = null
        setIsTracking(false)
        setIsFinalizingSync(false)
        setSessionId(null)
        setStartedAt(null)
        setLastSyncAt(null)
        setQueuedCount(0)
        toast.success('Finished syncing — today\'s shift is fully closed out.')
      }
    }
  }, [])

  const collectPoint = useCallback(async () => {
    if (!navigator.geolocation || !sessionIdRef.current || !employeeIdRef.current) {
      return
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { coords } = position
        const quality: LocationPointQuality =
          coords.accuracy != null && coords.accuracy > LOW_ACCURACY_THRESHOLD_METERS
            ? 'low_accuracy'
            : 'good'

        const point: PendingPoint = {
          employeeId: employeeIdRef.current!,
          trackingSessionId: sessionIdRef.current!,
          timestamp: Timestamp.now(),
          lat: coords.latitude,
          lng: coords.longitude,
          address: null,
          accuracy: coords.accuracy ?? null,
          // Device reports speed in m/s — convert to km/h for display consistency.
          speed: coords.speed != null ? Math.round(coords.speed * 3.6 * 10) / 10 : null,
          direction: coords.heading ?? null,
          batteryPercent: batteryPercentRef.current,
          networkStatus: (navigator.onLine ? 'online' : 'offline') as NetworkStatus,
          quality,
        }

        if (!navigator.onLine) {
          await enqueuePoint(point)
          setQueuedCount(await countQueuedPoints(sessionIdRef.current!))
          return
        }

        try {
          await flushOfflineQueue()
          // Phase T13: see firestoreResilience.ts — recovers a wedged
          // Firestore connection (permission-denied while genuinely
          // online) with one reset + retry before falling through to the
          // existing queue-on-failure handling below.
          await withConnectionRetry(() => recordLocationPoint(point))
          setLastSyncAt(new Date())
        } catch (error) {
          console.error('[useLiveTracking] Failed to record point:', error)
          await enqueuePoint(point)
          setQueuedCount(await countQueuedPoints(sessionIdRef.current!))
        }
      },
      (error) => {
        console.error('[useLiveTracking] getCurrentPosition failed:', error)
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    )
  }, [flushOfflineQueue])

  const scheduleNext = useCallback(() => {
    const batteryPercent = batteryPercentRef.current
    const interval =
      batteryPercent !== null && batteryPercent < LOW_BATTERY_THRESHOLD_PERCENT
        ? LOW_BATTERY_INTERVAL_MS
        : BASE_INTERVAL_MS

    timeoutRef.current = window.setTimeout(async () => {
      await collectPoint()
      scheduleNext()
    }, interval)
  }, [collectPoint])

  const start = useCallback(
    async (startEmployeeId: string, attendanceLogId: string) => {
      employeeIdRef.current = startEmployeeId
      const newSessionId = await startTrackingSession(startEmployeeId, attendanceLogId)
      sessionIdRef.current = newSessionId

      setSessionId(newSessionId)
      setStartedAt(new Date())
      setIsTracking(true)
      setIsFinalizingSync(false)
      setQueuedCount(0)

      await collectPoint()
      scheduleNext()
    },
    [collectPoint, scheduleNext]
  )

  const resumeIfActive = useCallback(
    async (resumeEmployeeId: string) => {
      if (isTracking) return // already running, nothing to resume

      const existing = await getActiveTrackingSession(resumeEmployeeId)
      if (!existing) return

      // Phase T12: a session with a deferred close pending already had
      // punch-out requested before this reload — from the employee's
      // perspective that shift is over, so don't resume collecting new
      // points onto it. The recovery effect below drains and closes it.
      if (await getPendingClose(existing.id)) return

      employeeIdRef.current = resumeEmployeeId
      sessionIdRef.current = existing.id

      setSessionId(existing.id)
      setStartedAt(existing.startTime.toDate())
      setIsTracking(true)
      setIsFinalizingSync(false)

      // Phase T12: pick up wherever a persisted offline queue left off
      // for this exact session (e.g. the app was killed mid-flush)
      // before resuming normal collection.
      await flushOfflineQueue()

      scheduleNext()
    },
    [isTracking, scheduleNext, flushOfflineQueue]
  )

  /**
   * Ends the current session — called on punch-out. If the offline queue
   * is already empty and closing the session succeeds immediately, this
   * behaves exactly as before T12. Otherwise the close is deferred: a
   * `pendingClose` marker is persisted (survives an app kill) and
   * `isFinalizingSync` flips on so the UI can show "still syncing" rather
   * than the session just vanishing — the session only actually
   * transitions to 'completed' in Firestore once every queued point has
   * landed, which is what guarantees the Cloud Function's aggregation
   * always sees the complete route, correctly ordered, whenever it runs.
   */
  const stop = useCallback(async () => {
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }

    const sid = sessionIdRef.current
    const eid = employeeIdRef.current
    setIsTracking(false)

    if (!sid) {
      setSessionId(null)
      setStartedAt(null)
      setLastSyncAt(null)
      setIsFinalizingSync(false)
      return
    }

    const remaining = await flushSessionQueue(sid)
    setQueuedCount(remaining)

    // Same fast-fail-instead-of-hang guard as flushSessionQueue/
    // maybeFinalizeClose above: an empty queue at this point doesn't mean
    // it's safe to write — e.g. the queue may have been empty to begin
    // with while already offline. Don't attempt endTrackingSession() at
    // all without connectivity; go straight to the deferred path instead
    // of hanging on a write that won't resolve.
    if (remaining === 0 && navigator.onLine) {
      try {
        // Phase T13: same wedged-connection recovery as elsewhere in this
        // file — see firestoreResilience.ts.
        await withConnectionRetry(() => endTrackingSession(sid))
        sessionIdRef.current = null
        employeeIdRef.current = null
        setSessionId(null)
        setStartedAt(null)
        setLastSyncAt(null)
        setIsFinalizingSync(false)
        return
      } catch (error) {
        console.error('[useLiveTracking] Failed to close tracking session, deferring:', error)
        // falls through to the deferred path below
      }
    }

    await setPendingClose(sid, eid ?? '')
    setIsFinalizingSync(true)
  }, [])

  const runRecovery = useCallback(
    async (forEmployeeId: string) => {
      try {
        const { pointsRecovered, sessionsClosed } = await recoverOrphanedSessions(
          forEmployeeId,
          sessionIdRef.current,
          activeAttendanceLogId
        )
        if (pointsRecovered > 0 || sessionsClosed > 0) {
          toast.success(
            `Synced ${pointsRecovered} GPS point${pointsRecovered === 1 ? '' : 's'} from a previous session` +
              (sessionsClosed > 0 ? ' and closed it out.' : '.')
          )
        }
      } catch (error) {
        console.error('[useLiveTracking] Recovery of offline queue failed:', error)
      }
    },
    [activeAttendanceLogId]
  )

  // Flush the current session's queue as soon as the browser reports
  // connectivity back, and take the opportunity to catch up any other
  // orphaned session too (covers "opened the app while still offline,
  // network came back later without a reload").
  useEffect(() => {
    function handleOnline() {
      flushOfflineQueue()
      if (employeeId) runRecovery(employeeId)
    }
    window.addEventListener('online', handleOnline)
    return () => window.removeEventListener('online', handleOnline)
  }, [employeeId, flushOfflineQueue, runRecovery])

  // Phase T12: recover anything left behind by a previous app instance
  // being killed — independent of whether attendance shows currently
  // punched in, since the employee may have already punched out (and
  // this session's own queue may already be empty) before the app died.
  // Deliberately re-runs when `runRecovery` changes (i.e. when
  // activeAttendanceLogId settles from "loading" to a real value), not
  // just once on mount — the first pass typically fires before
  // useAttendanceSession's own fetch resolves, so without this the
  // abandoned-active-session check (which needs to know attendance
  // status) would never get a real chance to run.
  useEffect(() => {
    if (!employeeId) return
    runRecovery(employeeId)
  }, [employeeId, runRecovery])

  useEffect(() => {
    return () => {
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current)
    }
  }, [])

  return {
    isTracking,
    sessionId,
    startedAt,
    lastSyncAt,
    queuedCount,
    isFinalizingSync,
    start,
    stop,
    resumeIfActive,
  }
}
