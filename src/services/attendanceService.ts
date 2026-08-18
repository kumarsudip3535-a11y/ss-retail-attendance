import {
  addDoc,
  collection,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
  type QueryConstraint,
} from 'firebase/firestore'
import { getFirebaseDb } from '@/services/firebase'
import {
  getPendingPunchOut,
  clearPendingPunchOut,
  type PendingPunchOut,
} from '@/utils/offlineQueueDb'
import { withConnectionRetry } from '@/utils/firestoreResilience'
import type { AttendanceLog } from '@/types'

const STANDARD_WORKDAY_HOURS = 8
const COLLECTION_NAME = 'attendanceLogs'

function docToAttendanceLog(
  id: string,
  data: ReturnType<typeof mapDocData>
): AttendanceLog {
  return { id, ...data }
}

// Narrow, defensive mapping from raw Firestore data to our typed shape.
function mapDocData(data: Record<string, unknown>) {
  return {
    employeeId: data.employeeId as string,
    loginTime: data.loginTime as Timestamp,
    loginLat: data.loginLat as number,
    loginLng: data.loginLng as number,
    logoutTime: (data.logoutTime as Timestamp | null) ?? null,
    logoutLat: (data.logoutLat as number | null) ?? null,
    logoutLng: (data.logoutLng as number | null) ?? null,
    totalHours: (data.totalHours as number | null) ?? null,
    overtimeHours: (data.overtimeHours as number | null) ?? null,
  }
}

/**
 * Returns the employee's currently active (not yet punched out) attendance
 * session, or null if there isn't one.
 */
export async function getActiveSession(
  employeeId: string
): Promise<AttendanceLog | null> {
  const db = getFirebaseDb()
  const logsRef = collection(db, COLLECTION_NAME)
  const q = query(
    logsRef,
    where('employeeId', '==', employeeId),
    where('logoutTime', '==', null),
    limit(1)
  )

  const snapshot = await getDocs(q)
  if (snapshot.empty) return null

  const docSnap = snapshot.docs[0]
  return docToAttendanceLog(docSnap.id, mapDocData(docSnap.data()))
}

/**
 * Creates a new attendance log for a Punch In. Throws if the employee
 * already has an active session — callers should catch this and show
 * "You have already punched in today."
 */
export async function punchIn(
  employeeId: string,
  lat: number,
  lng: number
): Promise<string> {
  const existing = await getActiveSession(employeeId)
  if (existing) {
    throw new Error('You have already punched in today.')
  }

  const db = getFirebaseDb()
  const logsRef = collection(db, COLLECTION_NAME)

  const docRef = await addDoc(logsRef, {
    employeeId,
    loginTime: serverTimestamp(),
    loginLat: lat,
    loginLng: lng,
    logoutTime: null,
    logoutLat: null,
    logoutLng: null,
    totalHours: null,
    overtimeHours: null,
  })

  return docRef.id
}

/**
 * Computes the punch-out numbers entirely client-side from an
 * already-known active session — no network round trip needed, unlike the
 * old flow this replaced (which re-read the session from Firestore just
 * to resolve loginTime). Everything required is already in memory from
 * the active session the UI is already displaying, which is what makes it
 * safe to persist this durably (see offlineQueueDb.ts) before we know
 * whether Firestore is reachable at all — `logoutTimestampMs` and the
 * computed hours are fixed at the true moment of the tap, not whenever a
 * deferred write eventually lands.
 */
export function computePunchOut(
  active: AttendanceLog,
  lat: number,
  lng: number
): PendingPunchOut {
  const logoutTimestampMs = Date.now()
  const loginDate = active.loginTime.toDate()

  const totalHours = Math.round(
    ((logoutTimestampMs - loginDate.getTime()) / 3600000) * 100
  ) / 100
  const overtimeHours =
    Math.round(Math.max(totalHours - STANDARD_WORKDAY_HOURS, 0) * 100) / 100

  return {
    employeeId: active.employeeId,
    attendanceLogId: active.id,
    loginTimeMs: loginDate.getTime(),
    loginLat: active.loginLat,
    loginLng: active.loginLng,
    logoutTimestampMs,
    logoutLat: lat,
    logoutLng: lng,
    totalHours,
    overtimeHours,
  }
}

/**
 * Writes a previously computed punch-out to Firestore. A single write, no
 * reads — and idempotent to retry: reasserting the same computed values a
 * second time (e.g. a retried deferred flush after a partial failure)
 * just overwrites with identical numbers, it can never double-count
 * hours.
 */
export async function writePunchOut(computation: PendingPunchOut): Promise<void> {
  const db = getFirebaseDb()
  const logRef = doc(db, COLLECTION_NAME, computation.attendanceLogId)
  await updateDoc(logRef, {
    logoutTime: Timestamp.fromMillis(computation.logoutTimestampMs),
    logoutLat: computation.logoutLat,
    logoutLng: computation.logoutLng,
    totalHours: computation.totalHours,
    overtimeHours: computation.overtimeHours,
  })
}

/**
 * Phase T12 follow-up: flushes one employee's durably-queued punch-out to
 * Firestore, if one is pending. Returns true only if it actually flushed
 * and cleared the marker — false both when there's nothing pending and
 * when the write itself failed, so callers can't tell those apart from
 * the return value alone (the console error is the signal for the
 * latter). Safe to call speculatively on every reconnect/app load; a
 * no-op when there's nothing queued.
 */
export async function flushPendingPunchOut(employeeId: string): Promise<boolean> {
  const pending = await getPendingPunchOut(employeeId)
  if (!pending) return false
  // Same fast-fail-instead-of-hang reasoning as the GPS flush path in
  // useLiveTracking.ts: this project's Firestore writes queue internally
  // and leave the promise pending rather than rejecting while offline.
  // Every caller here already treats this as fire-and-forget, so a hung
  // write can't freeze the UI — but without this check it would still
  // leave a stuck promise sitting in memory (and, on a flaky connection,
  // multiple overlapping stuck ones from repeated 'online' events), never
  // resolving until connectivity actually returns. Failing fast keeps
  // retries clean: the pendingClose-equivalent marker just stays put for
  // the next 'online' event or app load to try again.
  if (!navigator.onLine) return false
  try {
    // Phase T13: wrapped in withConnectionRetry — see firestoreResilience.ts.
    // A wedged Firestore connection (from repeated offline/online cycles)
    // surfaces as permission-denied on an otherwise valid, online write;
    // one connection reset + retry recovers it without a page reload.
    await withConnectionRetry(() => writePunchOut(pending))
    await clearPendingPunchOut(employeeId)
    return true
  } catch (error) {
    console.error('[attendanceService] Failed to flush pending punch-out:', error)
    return false
  }
}

export interface HistoryOptions {
  from?: Date
  to?: Date
  maxResults?: number
}

/**
 * Fetches an employee's attendance history, most recent first, optionally
 * bounded by a date range (both inclusive).
 */
export async function getAttendanceHistory(
  employeeId: string,
  options: HistoryOptions = {}
): Promise<AttendanceLog[]> {
  const db = getFirebaseDb()
  const logsRef = collection(db, COLLECTION_NAME)

  const constraints: QueryConstraint[] = [
    where('employeeId', '==', employeeId),
    orderBy('loginTime', 'desc'),
  ]

  if (options.from) {
    constraints.push(where('loginTime', '>=', Timestamp.fromDate(options.from)))
  }
  if (options.to) {
    constraints.push(where('loginTime', '<=', Timestamp.fromDate(options.to)))
  }
  if (options.maxResults) {
    constraints.push(limit(options.maxResults))
  }

  const q = query(logsRef, ...constraints)
  const snapshot = await getDocs(q)

  return snapshot.docs.map((docSnap) =>
    docToAttendanceLog(docSnap.id, mapDocData(docSnap.data()))
  )
}

/**
 * Fetches attendance logs for ALL employees within a date range, most
 * recent first. Used by the admin dashboard/table — unlike
 * getAttendanceHistory(), this is not scoped to a single employee.
 * Range + orderBy on the same field (loginTime) doesn't require a
 * composite index.
 */
export async function getAttendanceLogsForDateRange(
  from: Date,
  to: Date
): Promise<AttendanceLog[]> {
  const db = getFirebaseDb()
  const logsRef = collection(db, COLLECTION_NAME)

  const q = query(
    logsRef,
    where('loginTime', '>=', Timestamp.fromDate(from)),
    where('loginTime', '<=', Timestamp.fromDate(to)),
    orderBy('loginTime', 'desc')
  )

  const snapshot = await getDocs(q)
  return snapshot.docs.map((docSnap) =>
    docToAttendanceLog(docSnap.id, mapDocData(docSnap.data()))
  )
}
