import { onDocumentUpdated, onDocumentCreated } from 'firebase-functions/v2/firestore'
import { defineSecret } from 'firebase-functions/params'
import { logger } from 'firebase-functions'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp, FieldValue, type DocumentData } from 'firebase-admin/firestore'
import { toISTDateKey, istDayRange } from './geo'
import {
  computeRouteDistance,
  evaluateStep,
  pointTimeMs,
  sumSteps,
  DEFAULT_DISTANCE_OPTIONS,
  type DistanceOptions,
  type DistancePoint,
} from './routeDistance'
import { applyRoadCorrection } from './roadDistance'
import { reverseGeocode, sleep } from './geocode'
import { detectStops } from './stopDetection'
import { DEFAULT_TRACKING_CONFIG, type TrackingConfigDoc } from './config'

initializeApp()
const db = getFirestore()

// Set via: firebase functions:secrets:set RESEND_API_KEY (run by the user
// in their own terminal — the raw key must never be pasted into chat).
const resendApiKey = defineSecret('RESEND_API_KEY')

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
  /** Phase T2: epoch ms of the GPS fix itself (absent on points written before the fix). */
  fixTimeMs?: number | null
  accuracy?: number | null
  /** km/h, device-reported. */
  speed?: number | null
  quality?: LocationPointQuality
}

function distanceOptionsFor(config: TrackingConfigDoc): DistanceOptions {
  return {
    ...DEFAULT_DISTANCE_OPTIONS,
    maxAccuracyMeters: config.lowAccuracyThresholdMeters,
    implausibleSpeedKmh: IMPLAUSIBLE_SPEED_KMH,
  }
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
 * Computes, for one completed session:
 *   1. Total distance (Phase T2 filtered algorithm — see routeDistance.ts —
 *      plus OSRM road-distance correction for long straight-line steps)
 *   2. Detected stops (dwell-radius clustering)
 *   3. Route segments between stops (login -> stop1 -> stop2 -> ... -> logout),
 *      using exactly the same filtered/corrected steps as the total, so the
 *      claim's GPS distance (sum of segments) and the session total agree.
 *   4. That employee's rolled-up numbers for the whole IST calendar day
 *
 * This is the ONLY code path that writes to stops/routeSegments/
 * dailyRouteSummaries — Firestore rules deny all client writes to those
 * collections, and this runs under the Admin SDK, which bypasses rules
 * entirely. That's what makes "employees can't edit their own GPS travel
 * records" actually true.
 */
async function aggregateSession(sessionId: string, session: DocumentData): Promise<void> {
  const employeeId = session.employeeId as string
  const sessionStartTime = session.startTime as Timestamp

  logger.info(`[tracking] Aggregating closed session ${sessionId} for employee ${employeeId}`)

  const config = await loadTrackingConfig()
  const distanceOpts = distanceOptionsFor(config)

  const pointsSnap = await db
    .collection('locationPoints')
    .where('trackingSessionId', '==', sessionId)
    .orderBy('timestamp', 'asc')
    .get()

  // Phase T2: order by the GPS fix time, not the write time — a burst of
  // fixes delivered late by a throttled WebView must keep its true order.
  const points = pointsSnap.docs
    .map((d) => ({ id: d.id, ...(d.data() as LocationPointDoc) }))
    .map((p) => ({ ...p, tMs: pointTimeMs(p) }))
    .sort((a, b) => a.tMs - b.tMs)

  if (points.length === 0) {
    logger.warn(`[tracking] Session ${sessionId} closed with zero location points.`)
    await db.doc(`trackingSessions/${sessionId}`).update({ totalDistanceKm: 0, totalPoints: 0 })
    await recomputeDailySummary(employeeId, sessionStartTime.toDate())
    return
  }

  // --- 1. Distance ---
  const distancePoints: DistancePoint[] = points.map((p) => ({
    lat: p.lat,
    lng: p.lng,
    tMs: p.tMs,
    accuracy: p.accuracy ?? null,
    speedKmh: p.speed ?? null,
  }))
  const filtered = computeRouteDistance(distancePoints, distanceOpts)
  const road = await applyRoadCorrection(distancePoints, filtered.steps, {
    enabled: config.roadDistanceCorrection,
    osrmBaseUrl: config.osrmBaseUrl,
    maxDetourRatio: 2.5,
    maxCorrectionsPerSession: 400,
    gapMeters: distanceOpts.gapMeters,
    implausibleSpeedKmh: IMPLAUSIBLE_SPEED_KMH,
  })
  const steps = road.steps

  // Persist the glitch flag onto the point docs (Admin SDK bypasses the
  // client-facing `allow update: if false` rule on purpose). Only ever
  // escalates a point to needs_review — never downgrades an earlier flag.
  const glitchPointIds = new Set(filtered.glitchIdx.map((i) => points[i].id))
  if (glitchPointIds.size > 0) {
    let glitchBatch = db.batch()
    let ops = 0
    for (const p of points) {
      if (glitchPointIds.has(p.id) && p.quality !== 'needs_review') {
        glitchBatch.update(db.doc(`locationPoints/${p.id}`), { quality: 'needs_review' })
        p.quality = 'needs_review'
        if (++ops === 450) {
          await glitchBatch.commit()
          glitchBatch = db.batch()
          ops = 0
        }
      }
    }
    if (ops > 0) await glitchBatch.commit()
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
  // Phase T2: the session total is the sum of its travel segments, so
  // GPS drift while parked at a detected stop never counts as distance,
  // and the total always equals what a travel claim adds up.
  let travelMeters = 0
  let travelStraightMeters = 0
  // Walk boundary pairs (start-of-travel -> end-of-travel): skip the
  // zero-length pairs that fall *inside* a stop.
  for (let i = 0; i + 1 < boundaries.length; i += 2) {
    const from = boundaries[i]
    const to = boundaries[i + 1]
    if (to.idx <= from.idx) continue

    // Phase T2: same filtered + road-corrected steps as the session total.
    const segmentDistanceMeters = sumSteps(steps, from.idx, to.idx)
    travelMeters += segmentDistanceMeters
    travelStraightMeters += sumSteps(filtered.steps, from.idx, to.idx)
    const travelTimeMinutes = Math.round(((points[to.idx].tMs - points[from.idx].tMs) / 60000) * 10) / 10

    // Quality is summarized over every point in this segment's travel
    // span; an admin decides via reviewStatus whether to exclude the leg.
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

  const totalDistanceKm = Math.round((travelMeters / 1000) * 100) / 100
  const straightLineKm = Math.round((travelStraightMeters / 1000) * 100) / 100

  // --- Update the session's own aggregate fields ---
  await db.doc(`trackingSessions/${sessionId}`).update({
    totalDistanceKm,
    totalPoints: points.length,
    straightLineDistanceKm: straightLineKm,
    roadCorrectedSteps: road.corrected,
    distanceAlgorithmVersion: 2,
    distanceComputedAt: FieldValue.serverTimestamp(),
  })

  // --- 4. Whole-day rollup ---
  await recomputeDailySummary(employeeId, sessionStartTime.toDate())

  logger.info(
    `[tracking] Session ${sessionId} aggregated: ${totalDistanceKm}km ` +
      `(straight-line ${straightLineKm}km, ${road.corrected} step(s) road-corrected), ` +
      `${writtenStops.length} stops, ${points.length} points.`
  )
}

/**
 * Fires whenever a trackingSessions doc is updated. Reacts to:
 *   - active -> completed (normal punch-out), and
 *   - Phase T2: an admin setting/changing `recomputeRequestedAt` on an
 *     already-completed session (the "Recalculate distance" button on
 *     Route Replay) — re-runs the whole pipeline with the current
 *     algorithm, which is how sessions recorded before this fix get
 *     corrected numbers. aggregateSession never touches that field, so
 *     its own writes can't re-trigger this.
 */
export const onTrackingSessionClosed = onDocumentUpdated(
  {
    document: 'trackingSessions/{sessionId}',
    timeoutSeconds: 300,
    memory: '256MiB',
  },
  async (event) => {
    const sessionId = event.params.sessionId
    const before = event.data?.before.data()
    const after = event.data?.after.data()
    if (!before || !after) return

    const justClosed = before.status !== 'completed' && after.status === 'completed'
    const beforeReq = (before.recomputeRequestedAt as Timestamp | undefined)?.toMillis() ?? null
    const afterReq = (after.recomputeRequestedAt as Timestamp | undefined)?.toMillis() ?? null
    const recomputeRequested = after.status === 'completed' && afterReq !== null && afterReq !== beforeReq

    if (!justClosed && !recomputeRequested) return
    await aggregateSession(sessionId, after)
  }
)

/** Small in-memory cache so the per-point trigger doesn't re-read config every fix. */
let cachedConfig: { value: TrackingConfigDoc; at: number } | null = null
async function loadTrackingConfigCached(): Promise<TrackingConfigDoc> {
  if (cachedConfig && Date.now() - cachedConfig.at < 5 * 60_000) return cachedConfig.value
  const value = await loadTrackingConfig()
  cachedConfig = { value, at: Date.now() }
  return value
}

/**
 * Phase T2: live running distance while a shift is still active. Before
 * this, distance only existed after punch-out — the admin live map and the
 * employee's banner had nothing to show mid-trip. Each new point is run
 * through the same evaluateStep() rules as the final computation and
 * added to `liveDistanceKm` on liveSessionStats/{sessionId}. (Straight-line only — the
 * road correction happens once, at punch-out, so the final figure can be
 * a little higher than the last live reading.)
 *
 * Out-of-order points (an older offline-queued fix arriving after newer
 * ones) are skipped here; the final aggregation still includes them.
 */
export const onLocationPointCreated = onDocumentCreated(
  {
    document: 'locationPoints/{pointId}',
    timeoutSeconds: 30,
    memory: '256MiB',
  },
  async (event) => {
    const data = event.data?.data() as (LocationPointDoc & { trackingSessionId?: string }) | undefined
    if (!data?.trackingSessionId) return
    const config = await loadTrackingConfigCached()
    const opts = distanceOptionsFor(config)
    const candidate: DistancePoint = {
      lat: data.lat,
      lng: data.lng,
      tMs: pointTimeMs(data),
      accuracy: data.accuracy ?? null,
      speedKmh: data.speed ?? null,
    }
    const sessionRef = db.doc(`trackingSessions/${data.trackingSessionId}`)
    // Kept in its own collection (not on the session doc) so these
    // per-point writes don't fire onTrackingSessionClosed every few seconds.
    const statsRef = db.doc(`liveSessionStats/${data.trackingSessionId}`)

    await db.runTransaction(async (tx) => {
      const [sessionSnap, statsSnap] = await Promise.all([tx.get(sessionRef), tx.get(statsRef)])
      if (!sessionSnap.exists || sessionSnap.get('status') !== 'active') return
      const s = (statsSnap.exists ? statsSnap.data() : {}) as {
        liveDistanceKm?: number
        anchor?: DistancePoint
        rejectStreak?: number
        pointCount?: number
      }
      const base = {
        employeeId: sessionSnap.get('employeeId') as string,
        trackingSessionId: data.trackingSessionId,
        pointCount: (s.pointCount ?? 0) + 1,
        updatedAt: FieldValue.serverTimestamp(),
      }
      const anchor = s.anchor
      if (!anchor) {
        const usable = !(candidate.accuracy != null && candidate.accuracy > opts.maxAccuracyMeters)
        tx.set(statsRef, { ...base, liveDistanceKm: 0, rejectStreak: 0, ...(usable ? { anchor: candidate } : {}) }, { merge: true })
        return
      }
      if (candidate.tMs <= anchor.tMs) {
        tx.set(statsRef, base, { merge: true }) // late/out-of-order — final aggregation handles it
        return
      }

      const verdict = evaluateStep(anchor, candidate, opts)
      if (verdict.kind === 'accept') {
        const km = Math.round(((s.liveDistanceKm ?? 0) + verdict.meters / 1000) * 1000) / 1000
        tx.set(statsRef, { ...base, liveDistanceKm: km, anchor: candidate, rejectStreak: 0 }, { merge: true })
      } else if (verdict.kind === 'glitch') {
        const streak = (s.rejectStreak ?? 0) + 1
        tx.set(
          statsRef,
          streak >= opts.reanchorAfterRejects ? { ...base, anchor: candidate, rejectStreak: 0 } : { ...base, rejectStreak: streak },
          { merge: true }
        )
      } else {
        tx.set(statsRef, { ...base, ...(verdict.kind === 'jitter' ? { rejectStreak: 0 } : {}) }, { merge: true })
      }
    })
  }
)

/**
 * Phase T14 follow-up: fires once when a new employees/{employeeId} doc is
 * created (admin adds someone via Employee Management), and sends a
 * one-time "welcome aboard" email if — and only if — the admin filled in
 * an email address for that employee (Employee.email is optional; see its
 * doc comment in src/types/employee.ts). A no-op for the common case of no
 * email on file, and never blocks/undoes employee creation on failure —
 * this runs strictly after the employee doc already exists, and any error
 * here (bad API key, Resend outage, etc.) is only logged, never surfaced
 * to the admin who's mid-way through an unrelated Employee Management
 * screen.
 *
 * Uses Node 20's built-in global fetch() to call Resend's REST API
 * directly rather than adding the `resend` npm package as a dependency —
 * keeps functions/package.json's dependency footprint unchanged, matching
 * this codebase's existing preference for avoiding unnecessary
 * dependencies (see offlineQueueDb.ts's raw-IndexedDB-wrapper precedent on
 * the client side).
 *
 * Sends from onboarding@resend.dev, Resend's shared test sender that works
 * immediately with no domain verification — good enough for pilot rollout;
 * verifying a custom sending domain is a deliberately deferred follow-up
 * once the team wants production-grade deliverability to arbitrary real
 * inboxes.
 */
export const onEmployeeCreated = onDocumentCreated(
  {
    document: 'employees/{employeeId}',
    secrets: [resendApiKey],
    timeoutSeconds: 30,
    memory: '256MiB',
  },
  async (event) => {
    const employeeId = event.params.employeeId
    const data = event.data?.data()
    if (!data) return

    const email = data.email as string | null | undefined
    const name = (data.name as string | undefined) ?? 'there'

    if (!email) {
      logger.info(`[onboarding] Employee ${employeeId} has no email on file — skipping welcome email.`)
      return
    }

    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendApiKey.value()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'SS Retail Services <onboarding@resend.dev>',
          to: [email],
          subject: 'Congratulations, you are on board at SS Retail Services!',
          html: `<p>Hi ${name},</p><p>Congratulations, you are on board at SS Retail Services! We're glad to have you with us.</p>`,
        }),
      })

      if (!response.ok) {
        const body = await response.text()
        logger.error(`[onboarding] Resend API returned ${response.status} for employee ${employeeId}: ${body}`)
        return
      }

      logger.info(`[onboarding] Welcome email sent to ${email} for employee ${employeeId}.`)
    } catch (err) {
      logger.error(`[onboarding] Failed to send welcome email for employee ${employeeId}:`, err)
    }
  }
)
