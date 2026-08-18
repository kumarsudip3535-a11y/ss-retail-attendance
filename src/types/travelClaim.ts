import type { Timestamp } from 'firebase/firestore'

/** Which formula was used to calculate the fuel/travel expense. */
export type ReimbursementMethod =
  | 'fuel_mileage' // Method A: eligible KM ÷ mileage × fuel rate
  | 'per_km' // Method B: eligible KM × flat ₹/KM
  | 'custom_vehicle_rate' // Method C: eligible KM × this vehicle's own rate
  | 'manual' // Method D: admin enters the amount directly

export type ClaimStatus =
  | 'draft'
  | 'submitted'
  | 'approved'
  | 'rejected'
  | 'sent_back'

/** Automated cross-check between GPS distance and employee-entered odometer. */
export type VerificationStatus = 'verified' | 'needs_review' | 'mismatch'

/**
 * One employee's daily travel expense claim — spec sections 8, 14-17.
 * Auto-drafted from a completed TrackingSession, then reviewed/submitted
 * by the employee and approved/rejected by a manager.
 */
export interface TravelClaim {
  id: string
  employeeId: string
  trackingSessionId: string
  /**
   * Phase T9: the AttendanceLog this claim's session belongs to — kept
   * alongside trackingSessionId (the claim's own doc ID) specifically so
   * admin screens like the Claims queue can link straight to
   * /claim/:employeeId/:attendanceLogId without an extra tracking-session
   * lookup per row.
   */
  attendanceLogId: string
  date: Timestamp
  vehicleId: string | null

  // --- Distance breakdown (spec section 8) ---
  gpsDistanceKm: number
  eligibleDistanceKm: number
  personalDistanceKm: number

  // --- Optional odometer cross-check (spec section 9) ---
  odometerStartKm: number | null
  odometerEndKm: number | null
  odometerDistanceKm: number | null

  // --- Reimbursement calculation (spec sections 10-11) ---
  reimbursementMethod: ReimbursementMethod
  mileageUsed: number | null
  fuelRateUsed: number | null
  perKmRateUsed: number | null
  calculatedFuelExpense: number

  // --- Other expenses (spec section 14) ---
  tollExpense: number
  parkingExpense: number
  otherExpense: number
  notes: string | null
  receiptUrls: string[]

  totalClaim: number

  // --- Workflow (spec sections 15-17) ---
  status: ClaimStatus
  verificationStatus: VerificationStatus
  approvedBy: string | null
  approvedAt: Timestamp | null
  rejectionReason: string | null
}

export type TravelClaimFormInput = Omit<TravelClaim, 'id'>
