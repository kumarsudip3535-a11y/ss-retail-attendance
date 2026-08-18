import { Timestamp } from 'firebase/firestore'
import type { LocationPoint } from '@/types'

/**
 * Phase T12: durable offline queue for GPS points collected while the
 * device has no network. Before this phase, useLiveTracking.ts held the
 * queue in a plain `useRef` array — which meant a full tab/app close (not
 * just a background/foreground cycle) silently lost everything still
 * waiting to sync. This module backs the same queue with IndexedDB so it
 * survives that, plus a second small store for "this session was punched
 * out before its queue finished draining — close it once it does" markers
 * (see useLiveTracking.ts's `stop()` and the recovery effect for how
 * those get consumed).
 *
 * Firestore's `Timestamp` class isn't structured-clone-safe — IndexedDB's
 * structured clone would copy its enumerable seconds/nanoseconds fields
 * but drop the prototype, so `.toMillis()` etc. wouldn't survive a
 * read-back. Every point is therefore stored with a plain `timestampMs`
 * number and reconstructed with `Timestamp.fromMillis()` on the way out —
 * this is also exactly the value the reconciliation guarantee rests on:
 * because the *original capture time* survives intact regardless of how
 * late a point actually gets written to Firestore, a catch-up sync days
 * later still lands each point in its true chronological position once
 * the aggregation pipeline reads the session's points ordered by
 * `timestamp`.
 *
 * Phase T12 follow-up: a third store, `pendingPunchOuts`, applies the same
 * durable-first pattern to the Punch Out action itself. Testing T12 live
 * surfaced that `attendanceLogs`' punch-out write (a plain, unqueued
 * `updateDoc`) hangs indefinitely while offline rather than failing fast —
 * Firestore's JS SDK queues writes and only resolves the promise once the
 * write reaches the server, and this app never enabled offline
 * persistence. Since `useLiveTracking`'s own `stop()` was only ever called
 * *after* that write resolved, it meant the entire GPS deferred-close path
 * was unreachable through the UI while genuinely offline — the attendance
 * write blocked upstream of it. `attendanceService.ts`'s `computePunchOut`
 * / `writePunchOut` / `flushPendingPunchOut` and `useAttendanceSession.ts`
 * now compute the punch-out entirely client-side (everything needed is
 * already in memory from the active session the UI is already showing)
 * and persist it here before attempting the network write at all, so the
 * write is never on the critical path of the UI updating or of
 * `liveTracking.stop()` running.
 */

export type PendingPoint = Omit<LocationPoint, 'id'>

const DB_NAME = 'ssRetailOfflineQueue'
const DB_VERSION = 2
const POINTS_STORE = 'queuedPoints'
const PENDING_CLOSE_STORE = 'pendingCloses'
const PENDING_PUNCHOUT_STORE = 'pendingPunchOuts'

interface StoredPoint {
  localId: number
  employeeId: string
  trackingSessionId: string
  timestampMs: number
  payload: Omit<PendingPoint, 'timestamp'>
}

interface PendingClose {
  trackingSessionId: string
  employeeId: string
  requestedAtMs: number
}

/**
 * A durably-queued Punch Out, computed entirely client-side (see the
 * module doc comment above). Timestamps are plain millisecond numbers for
 * the same structured-clone reason as `StoredPoint.timestampMs` — and, as
 * with GPS points, this is what makes the write safe to retry arbitrarily
 * later: `logoutTimestampMs`/`totalHours`/`overtimeHours` are fixed at the
 * moment the employee actually tapped Punch Out, not recomputed against
 * whenever the deferred write finally lands, so a catch-up sync hours or
 * days later still records the true shift length.
 */
export interface PendingPunchOut {
  employeeId: string
  attendanceLogId: string
  loginTimeMs: number
  loginLat: number
  loginLng: number
  logoutTimestampMs: number
  logoutLat: number
  logoutLng: number
  totalHours: number
  overtimeHours: number
}

let dbPromise: Promise<IDBDatabase> | null = null

/**
 * Opens (and lazily creates) the database. Returns null instead of
 * throwing when IndexedDB isn't available (very old browsers, some
 * locked-down private-browsing modes) — every exported function below
 * degrades to a no-op/empty-result in that case, the same "missing
 * browser API degrades gracefully" pattern already used for the Battery
 * Status API elsewhere in useLiveTracking.ts.
 */
function openDb(): Promise<IDBDatabase> | null {
  if (typeof indexedDB === 'undefined') return null
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(POINTS_STORE)) {
          db.createObjectStore(POINTS_STORE, { keyPath: 'localId', autoIncrement: true })
        }
        if (!db.objectStoreNames.contains(PENDING_CLOSE_STORE)) {
          db.createObjectStore(PENDING_CLOSE_STORE, { keyPath: 'trackingSessionId' })
        }
        if (!db.objectStoreNames.contains(PENDING_PUNCHOUT_STORE)) {
          // At most one pending punch-out per employee at a time, so the
          // employeeId itself is a fine key — a second Punch Out can't
          // happen until the first one's active session is gone locally.
          db.createObjectStore(PENDING_PUNCHOUT_STORE, { keyPath: 'employeeId' })
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }
  return dbPromise
}

function store(db: IDBDatabase, name: string, mode: IDBTransactionMode) {
  return db.transaction(name, mode).objectStore(name)
}

function requestToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/** Queues one point durably. Best-effort — logs and no-ops on failure rather than throwing, so a storage hiccup can't take down GPS collection itself. */
export async function enqueuePoint(point: PendingPoint): Promise<void> {
  const dbP = openDb()
  if (!dbP) return
  try {
    const db = await dbP
    const { timestamp, ...rest } = point
    const stored: Omit<StoredPoint, 'localId'> = {
      employeeId: point.employeeId,
      trackingSessionId: point.trackingSessionId,
      timestampMs: timestamp.toMillis(),
      payload: rest,
    }
    await requestToPromise(store(db, POINTS_STORE, 'readwrite').add(stored))
  } catch (err) {
    console.error('[offlineQueueDb] Failed to persist queued point:', err)
  }
}

/**
 * Every queued point for one session, oldest capture time first — the
 * order they must be re-written in so the eventual Firestore read (also
 * ordered by `timestamp`) reconstructs the true route, regardless of what
 * order retries actually happen to succeed in.
 */
export async function getQueuedPoints(
  trackingSessionId: string
): Promise<{ localId: number; point: PendingPoint }[]> {
  const dbP = openDb()
  if (!dbP) return []
  try {
    const db = await dbP
    const all = (await requestToPromise(store(db, POINTS_STORE, 'readonly').getAll())) as StoredPoint[]
    return all
      .filter((s) => s.trackingSessionId === trackingSessionId)
      .sort((a, b) => a.timestampMs - b.timestampMs)
      .map((s) => ({
        localId: s.localId,
        point: { ...s.payload, timestamp: Timestamp.fromMillis(s.timestampMs) } as PendingPoint,
      }))
  } catch (err) {
    console.error('[offlineQueueDb] Failed to read queued points:', err)
    return []
  }
}

export async function countQueuedPoints(trackingSessionId: string): Promise<number> {
  return (await getQueuedPoints(trackingSessionId)).length
}

export async function removeQueuedPoint(localId: number): Promise<void> {
  const dbP = openDb()
  if (!dbP) return
  try {
    const db = await dbP
    await requestToPromise(store(db, POINTS_STORE, 'readwrite').delete(localId))
  } catch (err) {
    console.error('[offlineQueueDb] Failed to remove synced point:', err)
  }
}

/**
 * Every distinct trackingSessionId with at least one queued point, for
 * one employee — used on app relaunch to find leftover work when there's
 * no in-memory session reference left to anchor on (the app was fully
 * killed, not just backgrounded).
 */
export async function getSessionIdsWithQueuedPoints(employeeId: string): Promise<string[]> {
  const dbP = openDb()
  if (!dbP) return []
  try {
    const db = await dbP
    const all = (await requestToPromise(store(db, POINTS_STORE, 'readonly').getAll())) as StoredPoint[]
    return Array.from(new Set(all.filter((s) => s.employeeId === employeeId).map((s) => s.trackingSessionId)))
  } catch (err) {
    console.error('[offlineQueueDb] Failed to list queued sessions:', err)
    return []
  }
}

/** Marks a session as "punched out, but its offline queue hadn't fully synced yet" — see useLiveTracking.ts's stop(). */
export async function setPendingClose(trackingSessionId: string, employeeId: string): Promise<void> {
  const dbP = openDb()
  if (!dbP) return
  try {
    const db = await dbP
    const record: PendingClose = { trackingSessionId, employeeId, requestedAtMs: Date.now() }
    await requestToPromise(store(db, PENDING_CLOSE_STORE, 'readwrite').put(record))
  } catch (err) {
    console.error('[offlineQueueDb] Failed to persist pending close:', err)
  }
}

export async function getPendingClose(trackingSessionId: string): Promise<PendingClose | null> {
  const dbP = openDb()
  if (!dbP) return null
  try {
    const db = await dbP
    const result = await requestToPromise(store(db, PENDING_CLOSE_STORE, 'readonly').get(trackingSessionId))
    return (result as PendingClose | undefined) ?? null
  } catch (err) {
    console.error('[offlineQueueDb] Failed to read pending close:', err)
    return null
  }
}

export async function clearPendingClose(trackingSessionId: string): Promise<void> {
  const dbP = openDb()
  if (!dbP) return
  try {
    const db = await dbP
    await requestToPromise(store(db, PENDING_CLOSE_STORE, 'readwrite').delete(trackingSessionId))
  } catch (err) {
    console.error('[offlineQueueDb] Failed to clear pending close:', err)
  }
}

/**
 * Every pending-close session for one employee — the other half of
 * getSessionIdsWithQueuedPoints's job. A session can have a pendingClose
 * marker with zero points left queued (everything synced except the
 * close write itself never landed, e.g. the app died in the gap between
 * the last point flushing and `endTrackingSession` being called).
 */
export async function getPendingCloseSessionIds(employeeId: string): Promise<string[]> {
  const dbP = openDb()
  if (!dbP) return []
  try {
    const db = await dbP
    const all = (await requestToPromise(store(db, PENDING_CLOSE_STORE, 'readonly').getAll())) as PendingClose[]
    return all.filter((p) => p.employeeId === employeeId).map((p) => p.trackingSessionId)
  } catch (err) {
    console.error('[offlineQueueDb] Failed to list pending closes:', err)
    return []
  }
}

/**
 * Durably records a Punch Out before any network write is attempted — see
 * the module doc comment. Unlike the other functions here, callers should
 * treat a thrown/rejected promise as significant rather than swallowing
 * it: a punch-out is payroll-relevant, so `useAttendanceSession.doPunchOut`
 * needs to know if this failed (IndexedDB unavailable — very old browser
 * or a locked-down private-browsing mode) rather than silently proceeding
 * to clear the employee's punched-in state with no durable record at all.
 */
export async function setPendingPunchOut(record: PendingPunchOut): Promise<void> {
  const dbP = openDb()
  if (!dbP) throw new Error('IndexedDB is not available in this browser.')
  const db = await dbP
  await requestToPromise(store(db, PENDING_PUNCHOUT_STORE, 'readwrite').put(record))
}

export async function getPendingPunchOut(employeeId: string): Promise<PendingPunchOut | null> {
  const dbP = openDb()
  if (!dbP) return null
  try {
    const db = await dbP
    const result = await requestToPromise(store(db, PENDING_PUNCHOUT_STORE, 'readonly').get(employeeId))
    return (result as PendingPunchOut | undefined) ?? null
  } catch (err) {
    console.error('[offlineQueueDb] Failed to read pending punch-out:', err)
    return null
  }
}

export async function clearPendingPunchOut(employeeId: string): Promise<void> {
  const dbP = openDb()
  if (!dbP) return
  try {
    const db = await dbP
    await requestToPromise(store(db, PENDING_PUNCHOUT_STORE, 'readwrite').delete(employeeId))
  } catch (err) {
    console.error('[offlineQueueDb] Failed to clear pending punch-out:', err)
  }
}
