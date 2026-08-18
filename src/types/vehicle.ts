import type { Timestamp } from 'firebase/firestore'

export type VehicleType = 'motorcycle' | 'scooter' | 'car' | 'van' | 'other'
export type FuelType = 'petrol' | 'diesel' | 'cng' | 'electric' | 'other'

/** Vehicle Master record — spec section 12. */
export interface Vehicle {
  id: string
  vehicleNumber: string
  vehicleType: VehicleType
  fuelType: FuelType
  /** Km per litre (or per unit for CNG/electric — kept generic). */
  mileage: number
  /** Optional fixed fuel reimbursement rate override for this vehicle. */
  fuelReimbursementRate: number | null
  /** Optional fixed per-KM rate for this specific vehicle (Method C). */
  perKmRate: number | null
  assignedEmployeeId: string | null
  active: boolean
}

export type VehicleFormInput = Omit<Vehicle, 'id'>

/**
 * A dated fuel rate entry — history is preserved (never overwritten) so
 * past claims always use the rate that was active on that date, per
 * spec section 13.
 */
export interface FuelRate {
  id: string
  fuelType: FuelType
  ratePerLiter: number
  effectiveDate: Timestamp
  location: string | null
  source: string | null
  active: boolean
}

export type FuelRateFormInput = Omit<FuelRate, 'id'>
