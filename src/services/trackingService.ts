import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  Timestamp,
  updateDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore'
import { getFirebaseDb } from '@/services/firebase'
import type {
  DailyRouteSummary,
  LocationPoint,
  RouteSegment,
  SegmentReviewStatus,
  Stop,
  TrackingSession,
  TrackingSessionStatus,
  TravelClassification,
} from '@/types'

const SESSIONS_COLLECTION = 'trackingSessions'
const POINTS_COLLECTION = 'locationPoints'
const STOPS_COLLECTION = 'stops'
const SEGMENTS_COLLECTION = 'routeSegments'
const SUMMARIES_COLLECTION = 'dailyRouteSummaries'

/**
 * Starts a new tracking session, tied to the attendance log that
 * triggered it. Tracking must never run outside a punched-in window —
 * see spec section 27 (privacy). Returns the new session's ID.
 */
export async function startTrackingSession(
  employeeId: string,
  attendanceLogId: string
): Promise<string> {
  const db = getFirebaseDb()
  const docRef = await addDoc(collection(db, SESSIONS_COLLECTION), {
    employeeId,
    attendanceLogId,
    startTime: Timestamp.now(),
    endTime: null,
    status: 'active',
    totalDistanceKm: null,
    totalPoints: 0,
  })
  return docRef.id
}

/**
 * Phase T13: cheap status-only lookup for one session by ID. Used when a
 * queued GPS point write comes back `permission-denied` — firestore.rules
 * only allows writing a locationPoint into a still-*active* session, so
 * this is how flushSessionQueue (useLiveTracking.ts) tells apart "the
 * connection is wedged, worth retrying" from "this point's session has
 * since closed, this can never succeed." Returns null if the session
 * doesn't exist at all (e.g. deleted), which callers treat the same as
 * "not active."
 */
export async function getTrackingSessionStatus(
  sessionId: string
): Promise<TrackingSessionStatus | null> {
  const db = getFirebaseDb()
  const snap = await getDoc(doc(db, SESSIONS_COLLECTION, sessionId))
  if (!snap.exists()) return null
  return snap.data().status as TrackingSessionStatus
}

/**
 * Ends a tracking session. Distance/point-count aggregation happens in
 * Phase T3's route computation, not here — this just closes the session.
 */
export async function endTrackingSession(sessionId: string): Promise<void> {
  const db = getFirebaseDb()
  await updateDoc(doc(db, SESSIONS_COLLECTION, sessionId), {
    endTime: Timestamp.now(),
    status: 'completed',
  })
}

/**
 * Finds an employee's currently active tracking session, if any. Used
 * to resume collection after a page refresh without starting a
 * duplicate session for the same punch-in.
 */
export async function getActiveTrackingSession(
  employeeId: string
): Promise<TrackingSession | null> {
  const db = getFirebaseDb()
  const q = query(
    collection(db, SESSIONS_COLLECTION),
    where('employeeId', '==', employeeId),
    where('status', '==', 'active'),
    limit(1)
  )

  const snapshot = await getDocs(q)
  if (snapshot.empty) return null

  const docSnap = snapshot.docs[0]
  const data = docSnap.data()

  return {
    id: docSnap.id,
    employeeId: data.employeeId,
    attendanceLogId: data.attendanceLogId,
    startTime: data.startTime,
    endTime: data.endTime ?? null,
    status: data.status,
    totalDistanceKm: data.totalDistanceKm ?? null,
    totalPoints: data.totalPoints ?? 0,
  }
}

/**
 * Finds the tracking session tied to a specific attendance log — a
 * session is created 1:1 with the punch-in that started it (see
 * startTrackingSession), so this is how Phase T5's Route Replay screen
 * gets from "an attendance record" to "the route to play back."
 * Returns null if that punch-in never had tracking (e.g. it predates
 * Phase T3, or tracking was off for that shift).
 *
 * Requires employeeId even though attendanceLogId alone is already
 * unique — Firestore evaluates security rules against a query's
 * *potential* result set, not its actual results. Our rule for
 * trackingSessions is `isSelf(resource.data.employeeId) || isAdmin()`;
 * without an employeeId filter matching that condition, Firestore can't
 * prove a non-admin caller's query only returns their own docs and
 * rejects it outright — even when the one matching document genuinely
 * is theirs. This bit us in testing (worked while admin, "Missing or
 * insufficient permissions" as a plain employee) until this filter was
 * added.
 */
export async function getTrackingSessionByAttendanceLogId(
  employeeId: string,
  attendanceLogId: string
): Promise<TrackingSession | null> {
  const db = getFirebaseDb()
  const q = query(
    collection(db, SESSIONS_COLLECTION),
    where('employeeId', '==', employeeId),
    where('attendanceLogId', '==', attendanceLogId),
    limit(1)
  )

  const snapshot = await getDocs(q)
  if (snapshot.empty) return null

  const docSnap = snapshot.docs[0]
  const data = docSnap.data()

  return {
    id: docSnap.id,
    employeeId: data.employeeId,
    attendanceLogId: data.attendanceLogId,
    startTime: data.startTime,
    endTime: data.endTime ?? null,
    status: data.status,
    totalDistanceKm: data.totalDistanceKm ?? null,
    totalPoints: data.totalPoints ?? 0,
  }
}

function docToSession(docSnap: { id: string; data: () => Record<string, unknown> }): TrackingSession {
  const data = docSnap.data()
  return {
    id: docSnap.id,
    employeeId: data.employeeId as string,
    attendanceLogId: data.attendanceLogId as string,
    startTime: data.startTime as TrackingSession['startTime'],
    endTime: (data.endTime as TrackingSession['endTime']) ?? null,
    status: data.status as TrackingSession['status'],
    totalDistanceKm: (data.totalDistanceKm as number | null) ?? null,
    totalPoints: (data.totalPoints as number) ?? 0,
  }
}

/**
 * Phase T10: every tracking session across ALL employees that started
 * within a date range — the Daily/Monthly Travel Report's data source.
 * Deliberately admin-only: no employeeId filter, so this is only provable
 * under trackingSessions' `isSelf(...) || isAdmin()` rule for an admin
 * caller (isAdmin() doesn't depend on resource data, same reasoning as
 * travelClaimService.ts's getClaimsByStatus). A single-field range query
 * on startTime needs no composite index.
 */
export async function getSessionsForDateRange(from: Date, to: Date): Promise<TrackingSession[]> {
  const db = getFirebaseDb()
  const q = query(
    collection(db, SESSIONS_COLLECTION),
    where('startTime', '>=', Timestamp.fromDate(from)),
    where('startTime', '<', Timestamp.fromDate(to)),
    orderBy('startTime', 'asc')
  )
  const snapshot = await getDocs(q)
  return snapshot.docs.map(docToSession)
}

/**
 * Every tracking session for one employee within a date range — the
 * Travel Reports "By Employee" tab's data source. Backed by the existing
 * employeeId+startTime composite index (already added for other T3/T5
 * queries), so no new index is needed.
 */
export async function getSessionsForEmployeeDateRange(
  employeeId: string,
  from: Date,
  to: Date
): Promise<TrackingSession[]> {
  const db = getFirebaseDb()
  const q = query(
    collection(db, SESSIONS_COLLECTION),
    where('employeeId', '==', employeeId),
    where('startTime', '>=', Timestamp.fromDate(from)),
    where('startTime', '<', Timestamp.fromDate(to)),
    orderBy('startTime', 'asc')
  )
  const snapshot = await getDocs(q)
  return snapshot.docs.map(docToSession)
}

/** Writes a single raw GPS reading to Firestore. */
export async function recordLocationPoint(
  point: Omit<LocationPoint, 'id'>
): Promise<void> {
  const db = getFirebaseDb()
  await addDoc(collection(db, POINTS_COLLECTION), point)
}

/**
 * Reads every raw GPS point collected for a session, oldest first — the
 * raw trail behind Route Replay's playback. Filters by employeeId in
 * addition to trackingSessionId for the same reason
 * getTrackingSessionByAttendanceLogId does — see that function's doc
 * comment. This is also why there's a dedicated `employeeId +
 * trackingSessionId + timestamp` composite index alongside the
 * `trackingSessionId + timestamp` one the Cloud Function's own
 * (rules-exempt, Admin-SDK) query still needs.
 */
export async function getLocationPointsForSession(
  employeeId: string,
  sessionId: string
): Promise<LocationPoint[]> {
  const db = getFirebaseDb()
  const q = query(
    collection(db, POINTS_COLLECTION),
    where('employeeId', '==', employeeId),
    where('trackingSessionId', '==', sessionId),
    orderBy('timestamp', 'asc')
  )
  const snapshot = await getDocs(q)
  return snapshot.docs.map((docSnap) => ({
    id: docSnap.id,
    ...(docSnap.data() as Omit<LocationPoint, 'id'>),
  }))
}

/**
 * Reads the stops detected for a session (written only by the Phase T3
 * Cloud Function — see functions/src/index.ts's onTrackingSessionClosed),
 * oldest arrival first. Filters by employeeId for the same
 * query-provability reason as getLocationPointsForSession above.
 */
export async function getStopsForSession(
  employeeId: string,
  sessionId: string
): Promise<Stop[]> {
  const db = getFirebaseDb()
  const q = query(
    collection(db, STOPS_COLLECTION),
    where('employeeId', '==', employeeId),
    where('trackingSessionId', '==', sessionId),
    orderBy('arrivalTime', 'asc')
  )
  const snapshot = await getDocs(q)
  return snapshot.docs.map((docSnap) => ({
    id: docSnap.id,
    ...(docSnap.data() as Omit<Stop, 'id'>),
  }))
}

/**
 * Reads the route legs between consecutive stops for a session (also
 * Cloud-Function-written only), oldest start-time first. Filters by
 * employeeId for the same query-provability reason as
 * getLocationPointsForSession above.
 */
export async function getRouteSegmentsForSession(
  employeeId: string,
  sessionId: string
): Promise<RouteSegment[]> {
  const db = getFirebaseDb()
  const q = query(
    collection(db, SEGMENTS_COLLECTION),
    where('employeeId', '==', employeeId),
    where('trackingSessionId', '==', sessionId),
    orderBy('startTime', 'asc')
  )
  const snapshot = await getDocs(q)
  return snapshot.docs.map((docSnap) => ({
    id: docSnap.id,
    ...(docSnap.data() as Omit<RouteSegment, 'id'>),
  }))
}

/**
 * Formats a Date as a yyyy-MM-dd key in Asia/Kolkata local time. Mirrors
 * functions/src/geo.ts's toISTDateKey exactly (Cloud Functions is a
 * separate npm package with no shared build, so this is intentionally
 * duplicated) — must stay in sync so the frontend and the aggregation
 * pipeline agree on what document ID a given day maps to.
 */
const istDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

function toISTDateKey(date: Date): string {
  return istDateFormatter.format(date)
}

/** Builds the `dailyRouteSummaries` document ID for an employee/date pair. */
export function dailyRouteSummaryId(employeeId: string, date: Date): string {
  return `${employeeId}_${toISTDateKey(date)}`
}

/**
 * Reads one employee's rolled-up route numbers for one calendar day.
 * Written once by the Cloud Functions aggregation pipeline when that
 * day's tracking session(s) close — see DailyRouteSummary's doc comment
 * in src/types/tracking.ts. Returns null if nothing has been computed
 * for that day yet (e.g. the employee hasn't punched in/out).
 */
export async function getDailyRouteSummary(
  employeeId: string,
  date: Date
): Promise<DailyRouteSummary | null> {
  const db = getFirebaseDb()
  const summaryId = dailyRouteSummaryId(employeeId, date)
  const snap = await getDoc(doc(db, SUMMARIES_COLLECTION, summaryId))
  if (!snap.exists()) return null
  return { id: snap.id, ...(snap.data() as Omit<DailyRouteSummary, 'id'>) }
}

/**
 * Phase T4: live-subscribes to every currently-active tracking session,
 * for the admin Live Tracking Map. Firing on every change (new session
 * starts, a session closes and drops out of the `active` filter) is what
 * lets the map add/remove employee markers in real time.
 */
export function subscribeToActiveTrackingSessions(
  onChange: (sessions: TrackingSession[]) => void
): Unsubscribe {
  const db = getFirebaseDb()
  const q = query(collection(db, SESSIONS_COLLECTION), where('status', '==', 'active'))

  return onSnapshot(q, (snapshot) => {
    const sessions = snapshot.docs.map((docSnap) => {
      const data = docSnap.data()
      return {
        id: docSnap.id,
        employeeId: data.employeeId,
        attendanceLogId: data.attendanceLogId,
        startTime: data.startTime,
        endTime: data.endTime ?? null,
        status: data.status,
        totalDistanceKm: data.totalDistanceKm ?? null,
        totalPoints: data.totalPoints ?? 0,
      } as TrackingSession
    })
    onChange(sessions)
  })
}

/**
 * Phase T4: live-subscribes to the single most recent GPS point for a
 * session, so an employee's marker on the admin map moves as new points
 * arrive instead of requiring a page refresh. Calls back with null if the
 * session has no points yet.
 */
export function subscribeToLatestLocationPoint(
  sessionId: string,
  onChange: (point: LocationPoint | null) => void
): Unsubscribe {
  const db = getFirebaseDb()
  const q = query(
    collection(db, POINTS_COLLECTION),
    where('trackingSessionId', '==', sessionId),
    orderBy('timestamp', 'desc'),
    limit(1)
  )

  return onSnapshot(q, (snapshot) => {
    if (snapshot.empty) {
      onChange(null)
      return
    }
    const docSnap = snapshot.docs[0]
    onChange({ id: docSnap.id, ...(docSnap.data() as Omit<LocationPoint, 'id'>) })
  })
}

/**
 * Phase T7: re-tags a stop's reimbursement classification (and optionally
 * its customer/purpose context) — e.g. correcting an auto-detected stop
 * from "official" to "personal" after the fact. A direct single-document
 * update by ID, not a query, so the list-query rule-provability issue
 * documented above (getLocationPointsForSession etc.) doesn't apply here;
 * the Firestore rule for `stops` still restricts *who* may call this
 * (the stop's own employee, or an admin) and *which* fields may change
 * (classification/customerName/purpose only — see firestore.rules).
 */
export async function updateStopClassification(
  stopId: string,
  classification: TravelClassification,
  customerName?: string | null,
  purpose?: string | null
): Promise<void> {
  const db = getFirebaseDb()
  const updates: Record<string, unknown> = { classification }
  if (customerName !== undefined) updates.customerName = customerName
  if (purpose !== undefined) updates.purpose = purpose
  await updateDoc(doc(db, STOPS_COLLECTION, stopId), updates)
}

/**
 * Phase T7: re-tags a route segment's reimbursement classification. Same
 * direct-by-ID update as updateStopClassification above — see that
 * function's doc comment for why the T5 query-safety lesson doesn't apply
 * here, and firestore.rules for the field-level restriction that does.
 */
export async function updateSegmentClassification(
  segmentId: string,
  classification: TravelClassification
): Promise<void> {
  const db = getFirebaseDb()
  await updateDoc(doc(db, SEGMENTS_COLLECTION, segmentId), { classification })
}

/**
 * Phase T11: an admin's disposition on a GPS-quality-flagged segment —
 * 'verified' (data's fine, keep it in calculations as-is) or 'excluded'
 * (bad data, drop its distance from eligible-KM/expense math regardless of
 * classification — see computeDistanceBreakdown). Direct by-ID update,
 * same reasoning as updateSegmentClassification above for why the T5
 * query-safety lesson doesn't apply; firestore.rules restricts this to
 * admins specifically (separate from the classification field's
 * self-or-admin allowance).
 */
export async function updateSegmentReviewStatus(
  segmentId: string,
  reviewStatus: SegmentReviewStatus
): Promise<void> {
  const db = getFirebaseDb()
  await updateDoc(doc(db, SEGMENTS_COLLECTION, segmentId), { reviewStatus })
}

/**
 * Phase T11: every route segment across ALL employees currently sitting
 * in a given review state — the Data Review Queue's data source.
 * Admin-only, same query-provability reasoning as getSessionsForDateRange
 * (T10): isAdmin() doesn't depend on resource data, so Firestore can prove
 * any query shape safe for an admin caller. One composite index
 * (reviewStatus + startTime) backs all three review states, since
 * equality-filter indexes aren't specific to the value being matched.
 * Capped at 500 — see the Data Review Queue page for what happens beyond
 * that (nothing silently hidden; the page says so).
 */
export async function getSegmentsByReviewStatus(reviewStatus: SegmentReviewStatus): Promise<RouteSegment[]> {
  const db = getFirebaseDb()
  const q = query(
    collection(db, SEGMENTS_COLLECTION),
    where('reviewStatus', '==', reviewStatus),
    orderBy('startTime', 'desc'),
    limit(500)
  )
  const snapshot = await getDocs(q)
  return snapshot.docs.map((docSnap) => ({
    id: docSnap.id,
    ...(docSnap.data() as Omit<RouteSegment, 'id'>),
  }))
}

/**
 * Single-document lookup by ID — used by the Data Review Queue to resolve
 * a flagged segment's trackingSessionId back to the attendanceLogId its
 * Route Replay link needs. A get()-by-ID, not a query, so (like
 * getDailyRouteSummary) the T5 query-provability issue doesn't apply.
 */
export async function getTrackingSessionById(sessionId: string): Promise<TrackingSession | null> {
  const db = getFirebaseDb()
  const snap = await getDoc(doc(db, SESSIONS_COLLECTION, sessionId))
  if (!snap.exists()) return null
  return docToSession(snap)
}
