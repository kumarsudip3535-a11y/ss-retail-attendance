import { onDocumentUpdated } from 'firebase-functions/v2/firestore'
import { logger } from 'firebase-functions'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore'
import { haversineDistanceMeters, toISTDateKey, istDayRange } from './geo'
import { reverseGeocode, sleep } from './geocode'
import { detectStops } from './stopDetection'
import { DEFAULT_TRACKING_CONFIG, type TrackingConfigDoc } from './config'

initializeApp()
const db = getFirestore()

/** Speed above which a distance jump is treated as a GPS glitch, not real movement. */
const IMPLAUSIBLE_SPEED_KMH = 180

// Mirrors src/types/tracking.ts's LocationPointQuality — functions is a
// separate npm package with no shared build (same duplication as geo.ts's
// toISTDateKey, see that file's comment), so this is intentionally
// re-declared rather than imported.
type LocationPointQuality = 'good' | 'low_accuracy' | 'needs_review'
type SegmentQualityFlag = 'low_accuracy' | 'needs_review'

interface LocationPointDoc {
  lat: number
  lng: number
  timestamp: Timestamp
  quality?: LocationPointQuality
}

/**
 * Phase T11: summarizes GPS quality across a contiguous slice of points
 * belonging to one route segment — the highest-severity flag present
 * (needs_review beats low_accuracy), plus how many points weren't 'good',
 * so the admin Data Review queue can show something more useful than a
 * bare yes/no.
 */
function summarizeSegmentQuality(
  segmentPoints: LocationPointDoc[]
): { qualityFlag: SegmentQualityFlag | null; flaggedPointCount: number } {
  let flaggedPointCount = 0
  let hasNeedsReview = false
  let hasLowAccuracy = false

  for (const p of segmentPoints) {
    const quality = p.quality ?? 'good'
    if (quality === 'needs_review') {
      hasNeedsReview = true
      flaggedPointCount++
    } else if (quality === 'low_accuracy') {
      hasLowAccuracy = true
      flaggedPointCount++
    }
  }

  const qualityFlag: SegmentQualityFlag | null = hasNeedsReview ? 'needs_review' : hasLowAccuracy ? 'low_accuracy' : null
  return { qualityFlag, flaggedPointCount }
}

async function loadTrackingConfig(): Promise<TrackingConfigDoc> {
  const snap = await db.collection('trackingConfig').doc('default').get()
  if (!snap.exists) return DEFAULT_TRACKING_CONFIG
  const data = snap.data() as Partial<TrackingConfigDoc>
  return { ...DEFAULT_TRACKING_CONFIG, ...data }
}

/**
 * Idempotency guard: clears any stops/routeSegments already written for
 * this session before recomputing. Normally this trigger fires exactly
 * once per session (the active->completed transition happens once), but
 * a Cloud Functions retry after a transient failure must not double-write.
 */
async function deleteExistingDerived(sessionId: string): Promise<void> {
  const [stopsSnap, segmentsSnap] = await Promise.all([
    db.collection('stops').where('trackingSessionId', '==', sessionId).get(),
    db.collection('routeSegments').where('trackingSessionId', '==', sessionId).get(),
  ])
  const batch = db.batch()
  stopsSnap.docs.forEach((d) => batch.delete(d.ref))
  segmentsSnap.docs.forEach((d) => batch.delete(d.ref))
  if (stopsSnap.size + segmentsSnap.size > 0) await batch.commit()
}

/**
 * Recomputes the whole-day rollup for one employee from scratch (rather
 * than incrementally patching a previous version) — simpler to reason
 * about and avoids double-counting when an employee has more than one
 * punch-in/punch-out cycle in a day.
 */
async function recomputeDailySummary(
  employeeId: string,
  referenceDate: Date
): Promise<void> {
  const dateKey = toISTDateKey(referenceDate)
  const { from, to } = istDayRange(referenceDate)
  const fromTs = Timestamp.fromDate(from)
  const toTs = Timestamp.fromDate(to)

  const [sessionsSnap, attendanceSnap] = await Promise.all([
    db
      .collection('trackingSessions')
      .where('employeeId', '==', employeeId)
      .where('startTime', '>=', fromTs)
      .where('startTime', '<=', toTs)
      .get(),
    db
      .collection('attendanceLogs')
      .where('employeeId', '==', employeeId)
      .where('loginTime', '>=', fromTs)
      .where('loginTime', '<=', toTs)
      .get(),
  ])

  interface TrackingSessionSummaryDoc {
    status: string
    totalDistanceKm: number | null
    totalPoints: number | undefined
  }

  const completedSessions = sessionsSnap.docs
    .map((d) => ({ id: d.id, ...(d.data() as TrackingSessionSummaryDoc) }))
    .filter((s) => s.status === 'completed')

  let totalDistanceKm = 0
  let stationaryDurationMinutes = 0
  let travelDurationMinutes = 0
  let stopCount = 0
  let hasGpsGaps = false
  let firstStop: { lat: number; lng: number; address: string | null; arrivalTime: Timestamp } | null = null
  let lastStop: { lat: number; lng: number; address: string | null; arrivalTime: Timestamp } | null = null

  for (const session of completedSessions) {
    totalDistanceKm += (session.totalDistanceKm as number | null) ?? 0
    if (((session.totalPoints as number | undefined) ?? 0) === 0) hasGpsGaps = true

    const [stopsSnap, segmentsSnap] = await Promise.all([
      db.collection('stops').where('trackingSessionId', '==', session.id).orderBy('arrivalTime', 'asc').get(),
      db.collection('routeSegments').where('trackingSessionId', '==', session.id).orderBy('startTime', 'asc').get(),
    ])

    for (const stopDoc of stopsSnap.docs) {
      const stop = stopDoc.data() as {
        lat: number
        lng: number
        address: string | null
        durationMinutes: number | null
        arrivalTime: Timestamp
      }
      stopCount += 1
      stationaryDurationMinutes += stop.durationMinutes ?? 0
      if (!firstStop || stop.arrivalTime.toMillis() < firstStop.arrivalTime.toMillis()) {
        firstStop = stop
      }
      if (!lastStop || stop.arrivalTime.toMillis() > lastStop.arrivalTime.toMillis()) {
        lastStop = stop
      }
    }
    for (const segDoc of segmentsSnap.docs) {
      const seg = segDoc.data() as { travelTimeMinutes: number | null }
      travelDurationMinutes += seg.travelTimeMinutes ?? 0
    }
  }

  const allAttendance = attendanceSnap.docs.map(
    (d) => d.data() as {
      loginTime: Timestamp
      loginLat: number
      loginLng: number
      logoutTime: Timestamp | null
      logoutLat: number | null
      logoutLng: number | null
      totalHours: number | null
    }
  )
  const completedAttendance = allAttendance.filter((a) => a.logoutTime)

  const workingDurationMinutes = completedAttendance.reduce(
    (sum, a) => sum + (a.totalHours ?? 0) * 60,
    0
  )

  const byLoginAsc = [...allAttendance].sort((a, b) => a.loginTime.toMillis() - b.loginTime.toMillis())
  const loginLocation = byLoginAsc.length > 0 ? { lat: byLoginAsc[0].loginLat, lng: byLoginAsc[0].loginLng } : null

  const byLogoutDesc = [...completedAttendance].sort(
    (a, b) => (b.logoutTime as Timestamp).toMillis() - (a.logoutTime as Timestamp).toMillis()
  )
  const logoutLocation =
    byLogoutDesc.length > 0
      ? { lat: byLogoutDesc[0].logoutLat as number, lng: byLogoutDesc[0].logoutLng as number }
      : null

  const summaryId = `${employeeId}_${dateKey}`
  await db
    .collection('dailyRouteSummaries')
    .doc(summaryId)
    .set({
      employeeId,
      date: Timestamp.fromDate(new Date(`${dateKey}T00:00:00.000+05:30`)),
      trackingSessionIds: completedSessions.map((s) => s.id),
      loginLocation,
      logoutLocation,
      firstDestination: firstStop
        ? { lat: firstStop.lat, lng: firstStop.lng, address: firstStop.address ?? null }
        : null,
      finalDestination: lastStop
        ? { lat: lastStop.lat, lng: lastStop.lng, address: lastStop.address ?? null }
        : null,
      totalDistanceKm: Math.round(totalDistanceKm * 100) / 100,
      workingDurationMinutes: Math.round(workingDurationMinutes),
      travelDurationMinutes: Math.round(travelDurationMinutes),
      stationaryDurationMinutes: Math.round(stationaryDurationMinutes),
      stopCount,
      locationsVisitedCount: stopCount,
      hasGpsGaps,
      computedAt: FieldValue.serverTimestamp(),
    })

  logger.info(`[tracking] Recomputed daily summary ${summaryId}: ${totalDistanceKm}km, ${stopCount} stops.`)
}

/**
 * Fires whenever a trackingSessions doc is updated. Only reacts to the
 * one transition that matters — active -> completed — computing:
 *   1. Total distance for the session (Haversine sum, GPS glitches filtered)
 *   2. Detected stops (dwell-radius clustering)
 *   3. Route segments between stops (login -> stop1 -> stop2 -> ... -> logout)
 *   4. That employee's rolled-up numbers for the whole IST calendar day
 *
 * This is the ONLY code path that writes to stops/routeSegments/
 * dailyRouteSummaries — Firestore rules deny all client writes to those
 * collections, and this function runs under the Admin SDK, which bypasses
 * rules entirely. That's what makes "employees can't edit their own GPS
 * travel records" actually true.
 */
export const onTrackingSessionClosed = onDocumentUpdated(
  {
    document: 'trackingSessions/{sessionId}',
    timeoutSeconds: 120,
    memory: '256MiB',
  },
  async (event) => {
    const sessionId = event.params.sessionId
    const before = event.data?.before.data()
    const after = event.data?.after.data()
    if (!before || !after) return

    if (before.status === 'completed' || after.status !== 'completed') {
      return // not the transition we care about
    }

    const employeeId = after.employeeId as string
    const sessionStartTime = after.startTime as Timestamp

    logger.info(`[tracking] Aggregating closed session ${sessionId} for employee ${employeeId}`)

    const config = await loadTrackingConfig()

    const pointsSnap = await db
      .collection('locationPoints')
      .where('trackingSessionId', '==', sessionId)
      .orderBy('timestamp', 'asc')
      .get()

    const points = pointsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as LocationPointDoc) }))

    if (points.length === 0) {
      logger.warn(`[tracking] Session ${sessionId} closed with zero location points.`)
      await db.doc(`trackingSessions/${sessionId}`).update({ totalDistanceKm: 0, totalPoints: 0 })
      await recomputeDailySummary(employeeId, sessionStartTime.toDate())
      return
    }

    // --- 1. Distance ---
    let totalDistanceMeters = 0
    const glitchPointIds = new Set<string>()
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1]
      const curr = points[i]
      const distMeters = haversineDistanceMeters(prev.lat, prev.lng, curr.lat, curr.lng)
      const seconds = (curr.timestamp.toMillis() - prev.timestamp.toMillis()) / 1000
      const impliedSpeedKmh = seconds > 0 ? distMeters / 1000 / (seconds / 3600) : 0

      if (impliedSpeedKmh > IMPLAUSIBLE_SPEED_KMH) {
        glitchPointIds.add(curr.id) // GPS glitch — excluded from the sum, flagged below
        continue
      }
      totalDistanceMeters += distMeters
    }
    const totalDistanceKm = Math.round((totalDistanceMeters / 1000) * 100) / 100

    // Phase T11: actually persist the glitch flag onto the point docs (the
    // previous version of this comment claimed this already happened — it
    // didn't). Admin SDK bypasses locationPoints' `allow update: if false`
    // rule on purpose: that rule stops a *client* from rewriting what it
    // reported, not this pipeline from marking a reading as suspect. Also
    // patch the in-memory copy so the segment loop below sees it — points
    // is read once, before this runs.
    if (glitchPointIds.size > 0) {
      const glitchBatch = db.batch()
      for (const p of points) {
        if (glitchPointIds.has(p.id)) {
          glitchBatch.update(db.doc(`locationPoints/${p.id}`), { quality: 'needs_review' })
          p.quality = 'needs_review'
        }
      }
      await glitchBatch.commit()
      logger.info(`[tracking] Session ${sessionId}: flagged ${glitchPointIds.size} implausible-speed point(s) needs_review.`)
    }

    // --- 2. Stop detection ---
    const stopCandidates = detectStops(points, config.stopRadiusMeters, config.stopMinDurationMinutes)

    await deleteExistingDerived(sessionId)

    const writtenStops: { id: string; address: string | null; startIdx: number; endIdx: number }[] = []
    for (const candidate of stopCandidates) {
      const address = await reverseGeocode(candidate.lat, candidate.lng)
      if (stopCandidates.indexOf(candidate) < stopCandidates.length - 1) {
        await sleep(1100) // respect Nominatim's ~1 req/sec usage policy
      }

      const stopRef = db.collection('stops').doc()
      await stopRef.set({
        trackingSessionId: sessionId,
        employeeId,
        arrivalTime: Timestamp.fromMillis(candidate.arrivalMs),
        departureTime: Timestamp.fromMillis(candidate.departureMs),
        lat: candidate.lat,
        lng: candidate.lng,
        address,
        durationMinutes: candidate.durationMinutes,
        customerName: null,
        purpose: null,
        classification: 'other',
      })
      writtenStops.push({ id: stopRef.id, address, startIdx: candidate.startIdx, endIdx: candidate.endIdx })
    }

    // --- 3. Route segments between stops ---
    type Boundary = { idx: number; stopId: string | null; label: string }
    const boundaries: Boundary[] = [{ idx: 0, stopId: null, label: 'Login Location' }]
    writtenStops.forEach((stop) => {
      boundaries.push({ idx: stop.startIdx, stopId: stop.id, label: stop.address ?? 'Stop' })
      boundaries.push({ idx: stop.endIdx, stopId: stop.id, label: stop.address ?? 'Stop' })
    })
    boundaries.push({ idx: points.length - 1, stopId: null, label: 'Logout Location' })

    const segmentBatch = db.batch()
    // Walk boundary pairs (start-of-travel -> end-of-travel): skip the
    // zero-length pairs that fall *inside* a stop (a stop's own
    // startIdx->endIdx span isn't a travel segment).
    for (let i = 0; i + 1 < boundaries.length; i += 2) {
      const from = boundaries[i]
      const to = boundaries[i + 1]
      if (to.idx <= from.idx) continue

      let segmentDistanceMeters = 0
      for (let p = from.idx + 1; p <= to.idx; p++) {
        segmentDistanceMeters += haversineDistanceMeters(
          points[p - 1].lat,
          points[p - 1].lng,
          points[p].lat,
          points[p].lng
        )
      }
      const travelTimeMinutes =
        Math.round(((points[to.idx].timestamp.toMillis() - points[from.idx].timestamp.toMillis()) / 60000) * 10) / 10

      // Phase T11: quality is summarized over every point *in* this
      // segment's travel span (from.idx..to.idx inclusive) — deliberately
      // not filtered out of segmentDistanceMeters above. Auto-dropping
      // individual glitch points from a segment's own distance is fragile;
      // instead the segment is flagged and an admin decides via
      // reviewStatus whether to exclude the whole leg from KM/expense math.
      const { qualityFlag, flaggedPointCount } = summarizeSegmentQuality(points.slice(from.idx, to.idx + 1))

      const segmentRef = db.collection('routeSegments').doc()
      segmentBatch.set(segmentRef, {
        trackingSessionId: sessionId,
        employeeId,
        fromStopId: from.stopId,
        toStopId: to.stopId,
        fromLabel: from.label,
        toLabel: to.label,
        distanceKm: Math.round((segmentDistanceMeters / 1000) * 1000) / 1000,
        travelTimeMinutes,
        startTime: points[from.idx].timestamp,
        endTime: points[to.idx].timestamp,
        classification: 'other',
        qualityFlag,
        flaggedPointCount,
        reviewStatus: qualityFlag ? 'unreviewed' : 'verified',
      })
    }
    await segmentBatch.commit()

    // --- Update the session's own aggregate fields ---
    await db.doc(`trackingSessions/${sessionId}`).update({
      totalDistanceKm,
      totalPoints: points.length,
    })

    // --- 4. Whole-day rollup ---
    await recomputeDailySummary(employeeId, sessionStartTime.toDate())

    logger.info(
      `[tracking] Session ${sessionId} aggregated: ${totalDistanceKm}km, ${writtenStops.length} stops, ${points.length} points.`
    )
  }
)
