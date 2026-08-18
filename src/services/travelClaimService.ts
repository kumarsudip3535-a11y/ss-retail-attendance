import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  query,
  collection,
  getDocs,
} from 'firebase/firestore'
import { getFirebaseDb } from '@/services/firebase'
import type {
  ClaimStatus,
  FuelRate,
  PersonalKmPolicy,
  ReimbursementMethod,
  RouteSegment,
  TravelClaim,
  TravelClaimFormInput,
  Vehicle,
  VerificationStatus,
} from '@/types'

const CLAIMS_COLLECTION = 'travelClaims'

/**
 * Every reimbursement method `types/travelClaim.ts` models, with the
 * plain-language label shown on both Route Replay's live preview (T8) and
 * the Travel Claim screen (T9) — kept here as the single shared source so
 * the two pages can't drift out of sync with each other.
 */
export const REIMBURSEMENT_METHOD_OPTIONS: { value: ReimbursementMethod; label: string }[] = [
  { value: 'fuel_mileage', label: 'Fuel + Mileage' },
  { value: 'per_km', label: 'Per KM (flat)' },
  { value: 'custom_vehicle_rate', label: "Vehicle's Rate" },
  { value: 'manual', label: 'Manual' },
]
export const ALL_REIMBURSEMENT_METHODS: ReimbursementMethod[] = REIMBURSEMENT_METHOD_OPTIONS.map((o) => o.value)

/**
 * Picks a sensible default method given what an employee is allowed to
 * use and whether they have a vehicle assigned — prefers Fuel + Mileage
 * when both are true (the most "actually calculated" method), falls back
 * down the list, and only lands on `allowed[0]` if none of the
 * vehicle-dependent methods are usable.
 */
export function pickDefaultReimbursementMethod(
  allowed: ReimbursementMethod[],
  hasVehicle: boolean
): ReimbursementMethod {
  if (allowed.includes('fuel_mileage') && hasVehicle) return 'fuel_mileage'
  if (allowed.includes('per_km')) return 'per_km'
  if (allowed.includes('custom_vehicle_rate') && hasVehicle) return 'custom_vehicle_rate'
  if (allowed.includes('manual')) return 'manual'
  return allowed[0] ?? 'manual'
}

/**
 * Phase T7: the distance math behind a day's "Eligible Distance" figure —
 * spec section 8. Deliberately a pure function (no Firestore reads/writes)
 * so it can run live against whatever RouteSegments are already loaded on
 * the Route Replay screen, recomputing instantly as an employee/admin
 * changes a segment's classification.
 *
 * Persisting this as an actual TravelClaim document is Phase T9's job (see
 * src/types/travelClaim.ts's doc comment — "Auto-drafted from a completed
 * TrackingSession" is explicitly listed as T9's first deliverable). T7
 * only needs the number to *exist and be correct*, not to be saved
 * anywhere yet.
 */
export interface DistanceBreakdown {
  gpsDistanceKm: number
  personalDistanceKm: number
  eligibleDistanceKm: number
  /**
   * True when the active policy subtracts personal distance but still
   * wants a human to look at it (manual_review), or excludes it pending
   * explicit approval (include_after_approval), AND there's actually some
   * personal distance to review. Purely a UI signal in T7 — there's no
   * approval workflow to act on it until Phase T9 exists.
   */
  needsReview: boolean
  /**
   * Phase T11: distance from segments an admin has excluded from
   * calculations entirely (RouteSegment.reviewStatus === 'excluded') —
   * bad GPS data, not personal travel. Already left out of gpsDistanceKm/
   * eligibleDistanceKm below; broken out here purely so the UI can show
   * why the GPS total looks lower than the raw route.
   */
  excludedDistanceKm: number
}

export function computeDistanceBreakdown(
  segments: Pick<RouteSegment, 'distanceKm' | 'classification' | 'reviewStatus'>[],
  policy: PersonalKmPolicy
): DistanceBreakdown {
  // Phase T11: a segment an admin has excluded after a GPS-quality review
  // is dropped before any of the policy math below — bad data shouldn't
  // count as GPS distance, personal distance, or eligible distance.
  // reviewStatus is undefined on segments computed before T11 shipped, so
  // this is a no-op for them (undefined !== 'excluded').
  const includedSegments = segments.filter((seg) => seg.reviewStatus !== 'excluded')
  const excludedDistanceKm = segments
    .filter((seg) => seg.reviewStatus === 'excluded')
    .reduce((sum, seg) => sum + (seg.distanceKm || 0), 0)

  const gpsDistanceKm = includedSegments.reduce((sum, seg) => sum + (seg.distanceKm || 0), 0)

  if (policy === 'fully_included') {
    return {
      gpsDistanceKm,
      personalDistanceKm: 0,
      eligibleDistanceKm: gpsDistanceKm,
      needsReview: false,
      excludedDistanceKm,
    }
  }

  const personalDistanceKm = includedSegments
    .filter((seg) => seg.classification === 'personal')
    .reduce((sum, seg) => sum + (seg.distanceKm || 0), 0)

  const eligibleDistanceKm = gpsDistanceKm - personalDistanceKm
  const needsReview =
    (policy === 'manual_review' || policy === 'include_after_approval') && personalDistanceKm > 0

  return { gpsDistanceKm, personalDistanceKm, eligibleDistanceKm, needsReview, excludedDistanceKm }
}

/**
 * Phase T7: cross-checks GPS-derived distance against an employee-entered
 * odometer reading (spec section 9) — a simple three-tier tolerance band
 * rather than a hard pass/fail, since GPS drift and odometer
 * rounding both make exact matches unrealistic.
 *
 * The 3x-tolerance boundary for "needs_review" vs. "mismatch" is a
 * starting placeholder, not a spec value — adjust here (or promote it to
 * its own TrackingConfig field) if real-world usage shows it's too
 * strict/loose.
 */
export function computeVerificationStatus(
  gpsDistanceKm: number,
  odometerDistanceKm: number,
  toleranceKm: number
): VerificationStatus {
  const diff = Math.abs(gpsDistanceKm - odometerDistanceKm)
  if (diff <= toleranceKm) return 'verified'
  if (diff <= toleranceKm * 3) return 'needs_review'
  return 'mismatch'
}

/**
 * Phase T8: turns an eligible-KM figure into a ₹ fuel/travel expense
 * amount, under whichever of the four methods `types/travelClaim.ts`
 * models (`ReimbursementMethod`). Pure and non-persisted, same pattern as
 * computeDistanceBreakdown above — recomputes live as the method or
 * inputs change on Route Replay, nothing is saved here.
 *
 * Deliberately does NOT total in tollExpense/parkingExpense/otherExpense —
 * T8's own deliverable is "calculates the correct fuel expense", and
 * those other line items (plus receipt upload) belong to the actual claim
 * entry form in Phase T9, once there's a travelClaims document for a
 * receipt URL to attach to.
 */
export interface FuelExpenseResult {
  calculatedFuelExpense: number
  mileageUsed: number | null
  fuelRateUsed: number | null
  perKmRateUsed: number | null
  /** Set when the method couldn't be computed (missing vehicle/rate/input) — calculatedFuelExpense is 0 in that case. */
  note: string | null
}

const NOT_COMPUTABLE = (note: string): FuelExpenseResult => ({
  calculatedFuelExpense: 0,
  mileageUsed: null,
  fuelRateUsed: null,
  perKmRateUsed: null,
  note,
})

export function computeFuelExpense(
  method: ReimbursementMethod,
  eligibleDistanceKm: number,
  vehicle: Vehicle | null,
  fuelRate: FuelRate | null,
  defaultPerKmRate: number,
  manualAmount: number | null
): FuelExpenseResult {
  if (method === 'manual') {
    if (manualAmount === null || manualAmount < 0) {
      return NOT_COMPUTABLE('Enter an amount.')
    }
    return {
      calculatedFuelExpense: Math.round(manualAmount * 100) / 100,
      mileageUsed: null,
      fuelRateUsed: null,
      perKmRateUsed: null,
      note: null,
    }
  }

  if (method === 'per_km') {
    return {
      calculatedFuelExpense: Math.round(eligibleDistanceKm * defaultPerKmRate * 100) / 100,
      mileageUsed: null,
      fuelRateUsed: null,
      perKmRateUsed: defaultPerKmRate,
      note: null,
    }
  }

  if (!vehicle) {
    return NOT_COMPUTABLE('No vehicle assigned to this employee — assign one in Vehicle Management.')
  }

  if (method === 'custom_vehicle_rate') {
    if (vehicle.perKmRate === null) {
      return NOT_COMPUTABLE(`${vehicle.vehicleNumber} has no custom per-KM rate set — add one in Vehicle Management.`)
    }
    return {
      calculatedFuelExpense: Math.round(eligibleDistanceKm * vehicle.perKmRate * 100) / 100,
      mileageUsed: null,
      fuelRateUsed: null,
      perKmRateUsed: vehicle.perKmRate,
      note: null,
    }
  }

  // method === 'fuel_mileage'
  if (!vehicle.mileage || vehicle.mileage <= 0) {
    return NOT_COMPUTABLE(`${vehicle.vehicleNumber} has no mileage recorded — add it in Vehicle Management.`)
  }
  // A vehicle's own fuelReimbursementRate is an explicit override; otherwise
  // fall back to the fuel rate resolved for its fuel type as of the shift's date.
  const effectiveRate = vehicle.fuelReimbursementRate ?? fuelRate?.ratePerLiter ?? null
  if (effectiveRate === null) {
    return NOT_COMPUTABLE(
      `No fuel rate on record for ${vehicle.fuelType} as of this date — add one in Vehicle Management.`
    )
  }
  return {
    calculatedFuelExpense: Math.round((eligibleDistanceKm / vehicle.mileage) * effectiveRate * 100) / 100,
    mileageUsed: vehicle.mileage,
    fuelRateUsed: effectiveRate,
    perKmRateUsed: null,
    note: null,
  }
}

// --- Phase T9: Travel Claim persistence (draft → submit → approve/reject/send back) ---

function docToTravelClaim(id: string, data: Record<string, unknown>): TravelClaim {
  return {
    id,
    employeeId: data.employeeId as string,
    trackingSessionId: data.trackingSessionId as string,
    attendanceLogId: data.attendanceLogId as string,
    date: data.date as Timestamp,
    vehicleId: (data.vehicleId as string | null) ?? null,
    gpsDistanceKm: (data.gpsDistanceKm as number) ?? 0,
    eligibleDistanceKm: (data.eligibleDistanceKm as number) ?? 0,
    personalDistanceKm: (data.personalDistanceKm as number) ?? 0,
    odometerStartKm: (data.odometerStartKm as number | null) ?? null,
    odometerEndKm: (data.odometerEndKm as number | null) ?? null,
    odometerDistanceKm: (data.odometerDistanceKm as number | null) ?? null,
    reimbursementMethod: data.reimbursementMethod as TravelClaim['reimbursementMethod'],
    mileageUsed: (data.mileageUsed as number | null) ?? null,
    fuelRateUsed: (data.fuelRateUsed as number | null) ?? null,
    perKmRateUsed: (data.perKmRateUsed as number | null) ?? null,
    calculatedFuelExpense: (data.calculatedFuelExpense as number) ?? 0,
    tollExpense: (data.tollExpense as number) ?? 0,
    parkingExpense: (data.parkingExpense as number) ?? 0,
    otherExpense: (data.otherExpense as number) ?? 0,
    notes: (data.notes as string | null) ?? null,
    receiptUrls: (data.receiptUrls as string[]) ?? [],
    totalClaim: (data.totalClaim as number) ?? 0,
    status: data.status as ClaimStatus,
    verificationStatus: data.verificationStatus as VerificationStatus,
    approvedBy: (data.approvedBy as string | null) ?? null,
    approvedAt: (data.approvedAt as Timestamp | null) ?? null,
    rejectionReason: (data.rejectionReason as string | null) ?? null,
  }
}

/**
 * Looks up the travel claim for a tracking session, if one has been
 * created yet. A direct get() by ID — the claim's document ID IS the
 * trackingSessionId (see createDraftClaim below) — so, like every other
 * single-document lookup in this app, the T5 list-query
 * rule-provability issue never applies here.
 */
export async function getClaimForSession(trackingSessionId: string): Promise<TravelClaim | null> {
  const db = getFirebaseDb()
  const snap = await getDoc(doc(db, CLAIMS_COLLECTION, trackingSessionId))
  if (!snap.exists()) return null
  return docToTravelClaim(snap.id, snap.data())
}

/**
 * Phase T9's "auto-generated daily Travel Claim draft" — but generated
 * lazily, the first time either the employee or an admin opens the Travel
 * Claim screen for a completed session, rather than via a Cloud Function
 * trigger firing the moment the session closes. This keeps the phase to a
 * rules + client-side deploy (no Functions redeploy, avoiding the
 * OneDrive/Eventarc friction Phase T3 ran into) while still meaning the
 * employee never manually "creates" a claim — it's simply there, pre-
 * filled with T7/T8's already-computed numbers, the moment they navigate
 * to it. Uses setDoc (not addDoc) with the trackingSessionId as the
 * document ID, guaranteeing exactly one claim per session — calling this
 * again for a session that already has a claim would silently overwrite
 * it, so callers must always getClaimForSession() first.
 */
export async function createDraftClaim(
  trackingSessionId: string,
  data: Omit<TravelClaimFormInput, 'status' | 'approvedBy' | 'approvedAt' | 'rejectionReason'>
): Promise<void> {
  const db = getFirebaseDb()
  await setDoc(doc(db, CLAIMS_COLLECTION, trackingSessionId), {
    ...data,
    status: 'draft' as ClaimStatus,
    approvedBy: null,
    approvedAt: null,
    rejectionReason: null,
  })
}

/**
 * Employee save/submit — used both for "Save Draft" (status stays
 * 'draft' or 'sent_back' as passed) and "Submit" (status: 'submitted').
 * Firestore rules restrict which claims/fields this is actually allowed
 * to touch; this function just performs the write the UI already gated.
 */
export async function saveClaim(
  claimId: string,
  data: Partial<Omit<TravelClaimFormInput, 'approvedBy' | 'approvedAt' | 'rejectionReason'>>
): Promise<void> {
  const db = getFirebaseDb()
  await updateDoc(doc(db, CLAIMS_COLLECTION, claimId), data)
}

/** Manager approves a submitted claim. */
export async function approveClaim(claimId: string, adminEmployeeId: string): Promise<void> {
  const db = getFirebaseDb()
  await updateDoc(doc(db, CLAIMS_COLLECTION, claimId), {
    status: 'approved' as ClaimStatus,
    approvedBy: adminEmployeeId,
    approvedAt: serverTimestamp(),
    rejectionReason: null,
  })
}

/** Manager rejects a submitted claim outright (not editable further by the employee). */
export async function rejectClaim(claimId: string, adminEmployeeId: string, reason: string): Promise<void> {
  const db = getFirebaseDb()
  await updateDoc(doc(db, CLAIMS_COLLECTION, claimId), {
    status: 'rejected' as ClaimStatus,
    approvedBy: adminEmployeeId,
    approvedAt: serverTimestamp(),
    rejectionReason: reason,
  })
}

/**
 * Manager sends a submitted claim back for corrections — unlike reject,
 * this leaves the claim in an employee-editable state (see firestore.rules'
 * `status in ['draft', 'sent_back']` check) so they can fix whatever the
 * note describes and resubmit, rather than starting over.
 */
export async function sendBackClaim(claimId: string, adminEmployeeId: string, reason: string): Promise<void> {
  const db = getFirebaseDb()
  await updateDoc(doc(db, CLAIMS_COLLECTION, claimId), {
    status: 'sent_back' as ClaimStatus,
    rejectionReason: reason,
  })
  void adminEmployeeId // who sent it back isn't tracked on the doc itself — only final approve/reject stamps approvedBy
}

/**
 * Admin queue — every claim with the given status (default: the ones
 * actually needing review), newest shift-date first. Only ever called
 * from admin-only screens: for a non-admin caller this query would hit
 * the same rule-provability wall as T5's original bug (no employeeId
 * filter to match `isSelf(resource.data.employeeId)`), but since
 * `isAdmin()` doesn't depend on resource data at all, Firestore can prove
 * the query safe for an admin caller regardless of filters.
 */
export async function getClaimsByStatus(status: ClaimStatus): Promise<TravelClaim[]> {
  const db = getFirebaseDb()
  const q = query(collection(db, CLAIMS_COLLECTION), where('status', '==', status))
  const snapshot = await getDocs(q)
  const claims = snapshot.docs.map((d) => docToTravelClaim(d.id, d.data()))
  return claims.sort((a, b) => b.date.toMillis() - a.date.toMillis())
}
