import type { Timestamp } from 'firebase/firestore'

export type NetworkStatus = 'online' | 'offline'

/** Quality flag for a raw GPS reading — never silently discarded, only flagged. */
export type LocationPointQuality = 'good' | 'low_accuracy' | 'needs_review'

/**
 * A single raw GPS reading collected during an active tracking session.
 * Mirrors spec section 1 field-for-field.
 */
export interface LocationPoint {
  id: string
  employeeId: string
  trackingSessionId: string
  timestamp: Timestamp
  lat: number
  lng: number
  /** Reverse-geocoded address, filled in lazily/best-effort — optional. */
  address: string | null
  /** GPS accuracy radius in meters, as reported by the device. */
  accuracy: number | null
  /** Speed in km/h, as reported by the device (or derived between points). */
  speed: number | null
  /** Compass heading in degrees, 0-359. */
  direction: number | null
  batteryPercent: number | null
  networkStatus: NetworkStatus
  quality: LocationPointQuality
}

export type TrackingSessionStatus = 'active' | 'completed'

/**
 * One field-duty tracking session, tied 1:1 to an attendanceLogs entry
 * (tracking only runs while punched in — see spec section 27 privacy
 * requirements). Aggregated route stats fill in once the session ends.
 */
export interface TrackingSession {
  id: string
  employeeId: string
  /** Links back to the attendanceLogs document that started this session. */
  attendanceLogId: string
  startTime: Timestamp
  endTime: Timestamp | null
  status: TrackingSessionStatus
  totalDistanceKm: number | null
  totalPoints: number
}

/** How a stop or segment has been classified for reimbursement purposes. */
export type TravelClassification =
  | 'official'
  | 'personal'
  | 'lunch'
  | 'home'
  | 'customer_visit'
  | 'office'
  | 'other'

/**
 * A detected stop within a tracking session (dwell-time based — see
 * Phase T3's stop-detection algorithm).
 */
export interface Stop {
  id: string
  trackingSessionId: string
  employeeId: string
  arrivalTime: Timestamp
  departureTime: Timestamp | null
  lat: number
  lng: number
  address: string | null
  durationMinutes: number | null
  customerName: string | null
  purpose: string | null
  classification: TravelClassification
}

/**
 * The most severe GPS quality issue found among a segment's constituent
 * points — 'needs_review' (a jump the aggregation pipeline judged
 * implausibly fast, e.g. a spoofed/glitched reading) outranks
 * 'low_accuracy' (just a wide accuracy radius reported by the device).
 * null means every point in the segment came back 'good'.
 */
export type SegmentQualityFlag = 'low_accuracy' | 'needs_review'

/**
 * Phase T11: an admin's disposition on a quality-flagged segment.
 * 'unreviewed' is the default the aggregation pipeline assigns whenever
 * qualityFlag is non-null (nothing to review otherwise, so it starts
 * 'verified'). Only an admin may move it from there — see firestore.rules.
 * 'excluded' is what actually removes the segment's distance from
 * eligible-KM/expense math (computeDistanceBreakdown), independent of
 * `classification` — a segment can be "official" travel and still be bad
 * data.
 */
export type SegmentReviewStatus = 'unreviewed' | 'verified' | 'excluded'

/** One leg of the journey between two consecutive stops. */
export interface RouteSegment {
  id: string
  trackingSessionId: string
  employeeId: string
  fromStopId: string | null
  toStopId: string | null
  fromLabel: string
  toLabel: string
  distanceKm: number
  travelTimeMinutes: number
  startTime: Timestamp
  endTime: Timestamp
  classification: TravelClassification
  /** Phase T11: computed by the aggregation pipeline from this segment's points. */
  qualityFlag: SegmentQualityFlag | null
  /** Phase T11: how many of this segment's points weren't 'good' quality. */
  flaggedPointCount: number
  /** Phase T11: admin review disposition — see SegmentReviewStatus doc comment. */
  reviewStatus: SegmentReviewStatus
}

/**
 * One employee's rolled-up route numbers for one calendar day — spec
 * sections 5 & 10. Written once by the Cloud Functions aggregation
 * pipeline when the day's tracking session(s) close; the admin dashboard,
 * reports, and route-report screens all read this instead of recomputing
 * from raw locationPoints on every page load. Document ID is
 * `${employeeId}_${yyyy-MM-dd}` so it's directly addressable.
 */
export interface DailyRouteSummary {
  id: string
  employeeId: string
  /** Calendar date this summary covers, midnight local. */
  date: Timestamp
  trackingSessionIds: string[]

  loginLocation: { lat: number; lng: number } | null
  logoutLocation: { lat: number; lng: number } | null
  firstDestination: { lat: number; lng: number; address: string | null } | null
  finalDestination: { lat: number; lng: number; address: string | null } | null

  totalDistanceKm: number
  workingDurationMinutes: number
  travelDurationMinutes: number
  stationaryDurationMinutes: number
  stopCount: number
  locationsVisitedCount: number

  /** True if one or more expected tracking points were missing/degraded
   * for this day (GPS disabled, permission revoked, prolonged offline) —
   * surfaced in reports per spec section 8 ("clearly mark missing GPS
   * data"). */
  hasGpsGaps: boolean

  computedAt: Timestamp
}

/**
 * How a route segment/stop tagged "personal" affects that day's
 * reimbursable distance — Phase T7. All four modes compute the same
 * gpsDistanceKm/personalDistanceKm split; they differ in what happens
 * next, which is why "manual_review" and "include_after_approval" only
 * fully come alive once Phase T9's approval workflow exists to act on
 * the flag they raise.
 */
export type PersonalKmPolicy =
  | 'auto_exclude' // personal distance is silently subtracted from eligible KM
  | 'manual_review' // personal distance is subtracted, but flagged for a human to double-check
  | 'fully_included' // classification is ignored — all distance counts as eligible
  | 'include_after_approval' // personal distance is excluded unless a manager explicitly approves including it

/**
 * Single shared document (`trackingConfig/default`) holding the
 * admin-configurable knobs for the whole tracking pipeline — spec
 * sections 3 & 4. Employees read this to know their own device's
 * collection interval; only admins may write it.
 */
export interface TrackingConfig {
  /** How often a field employee's device should collect a GPS point. */
  collectionIntervalSeconds: 15 | 30 | 60 | 300
  /** Wider interval used automatically once battery drops below the threshold below. */
  lowBatteryIntervalSeconds: 15 | 30 | 60 | 300
  lowBatteryThresholdPercent: number
  /** A point worse than this accuracy radius (meters) is flagged, not discarded. */
  lowAccuracyThresholdMeters: number
  /** Minimum time stationary within stopRadiusMeters to count as a "Stop". */
  stopMinDurationMinutes: number
  /** Movement radius (meters) within which the employee is still considered "at" the same stop. */
  stopRadiusMeters: number
  /** How "personal"-tagged distance affects eligible KM — see PersonalKmPolicy. */
  personalKmPolicy: PersonalKmPolicy
  /** GPS-vs-odometer distance difference (km) still counted as "Verified" rather than "Needs Review"/"Mismatch". */
  odometerToleranceKm: number
  /**
   * Flat ₹/KM rate used by reimbursement Method B ("per_km") — spec
   * section 11. Distinct from a Vehicle's own `perKmRate` (Method C,
   * "custom_vehicle_rate"), which overrides this on a per-vehicle basis.
   */
  defaultPerKmRate: number
  updatedAt: Timestamp
  updatedBy: string
}

export type TrackingConfigFormInput = Omit<TrackingConfig, 'updatedAt' | 'updatedBy'>
