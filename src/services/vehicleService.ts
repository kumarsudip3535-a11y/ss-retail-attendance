import {
  addDoc,
  collection,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore'
import { getFirebaseDb } from '@/services/firebase'
import type { FuelRate, FuelRateFormInput, FuelType, Vehicle, VehicleFormInput } from '@/types'

const VEHICLES_COLLECTION = 'vehicles'
const FUEL_RATES_COLLECTION = 'fuelRates'

function docToVehicle(id: string, data: Record<string, unknown>): Vehicle {
  return {
    id,
    vehicleNumber: data.vehicleNumber as string,
    vehicleType: data.vehicleType as Vehicle['vehicleType'],
    fuelType: data.fuelType as FuelType,
    mileage: data.mileage as number,
    fuelReimbursementRate: (data.fuelReimbursementRate as number | null) ?? null,
    perKmRate: (data.perKmRate as number | null) ?? null,
    assignedEmployeeId: (data.assignedEmployeeId as string | null) ?? null,
    active: (data.active as boolean) ?? true,
  }
}

function docToFuelRate(id: string, data: Record<string, unknown>): FuelRate {
  return {
    id,
    fuelType: data.fuelType as FuelType,
    ratePerLiter: data.ratePerLiter as number,
    effectiveDate: data.effectiveDate as Timestamp,
    location: (data.location as string | null) ?? null,
    source: (data.source as string | null) ?? null,
    active: (data.active as boolean) ?? true,
  }
}

/** Fetches every vehicle, sorted by registration number. */
export async function getAllVehicles(): Promise<Vehicle[]> {
  const db = getFirebaseDb()
  const q = query(collection(db, VEHICLES_COLLECTION), orderBy('vehicleNumber'))
  const snapshot = await getDocs(q)
  return snapshot.docs.map((docSnap) => docToVehicle(docSnap.id, docSnap.data()))
}

export async function createVehicle(data: VehicleFormInput): Promise<string> {
  const db = getFirebaseDb()
  const docRef = await addDoc(collection(db, VEHICLES_COLLECTION), data)
  return docRef.id
}

export async function updateVehicle(
  id: string,
  data: Partial<VehicleFormInput>
): Promise<void> {
  const db = getFirebaseDb()
  await updateDoc(doc(db, VEHICLES_COLLECTION, id), data)
}

/** Soft-disables (or re-enables) a vehicle — does not delete the record, so past claims that reference it stay intact. */
export async function setVehicleActive(id: string, active: boolean): Promise<void> {
  await updateVehicle(id, { active })
}

/**
 * Phase T8: finds the vehicle currently assigned to an employee, if any —
 * used to drive the "Fuel + Mileage" and "Vehicle's Rate" reimbursement
 * methods on Route Replay. The `vehicles` read rule is `isSignedIn()`
 * only (doesn't depend on any field on the document), so — unlike the
 * `employeeId`-scoped queries in trackingService.ts — this query has no
 * rule-provability issue to work around.
 */
export async function getVehicleForEmployee(employeeId: string): Promise<Vehicle | null> {
  const db = getFirebaseDb()
  const q = query(
    collection(db, VEHICLES_COLLECTION),
    where('assignedEmployeeId', '==', employeeId),
    where('active', '==', true),
    limit(1)
  )
  const snapshot = await getDocs(q)
  if (snapshot.empty) return null
  const docSnap = snapshot.docs[0]
  return docToVehicle(docSnap.id, docSnap.data())
}

/**
 * Fetches every fuel rate entry, most recently effective first. Used by
 * the admin Fuel Rate Management screen to show the full history.
 */
export async function getAllFuelRates(): Promise<FuelRate[]> {
  const db = getFirebaseDb()
  const q = query(collection(db, FUEL_RATES_COLLECTION), orderBy('effectiveDate', 'desc'))
  const snapshot = await getDocs(q)
  return snapshot.docs.map((docSnap) => docToFuelRate(docSnap.id, docSnap.data()))
}

/**
 * Adds a new dated fuel rate entry. There is deliberately no
 * `updateFuelRate` — per FuelRate's doc comment in types/vehicle.ts,
 * history is never overwritten, so past expense calculations (Phase T8)
 * always resolve to the rate that was genuinely in effect on that date.
 * To correct a mistaken entry, deactivate it (setFuelRateActive) and add
 * a new one — never edit ratePerLiter/effectiveDate on an existing doc.
 */
export async function createFuelRate(data: FuelRateFormInput): Promise<string> {
  const db = getFirebaseDb()
  const docRef = await addDoc(collection(db, FUEL_RATES_COLLECTION), data)
  return docRef.id
}

/** Deactivates (or reactivates) a fuel rate entry — e.g. to correct a data-entry mistake without rewriting history. */
export async function setFuelRateActive(id: string, active: boolean): Promise<void> {
  const db = getFirebaseDb()
  await updateDoc(doc(db, FUEL_RATES_COLLECTION, id), { active })
}

/**
 * Resolves the fuel rate that was actually in effect for a given fuel
 * type on a given date — the "past claims still use the rate active at
 * the time" guarantee from spec section 13. Picks the active rate with
 * the latest effectiveDate that is still on or before `date`. Returns
 * null if no rate has ever been set for that fuel type as of that date
 * (e.g. the very first entry hasn't been added yet).
 */
export async function resolveFuelRate(
  fuelType: FuelType,
  date: Date
): Promise<FuelRate | null> {
  const db = getFirebaseDb()
  const q = query(
    collection(db, FUEL_RATES_COLLECTION),
    where('fuelType', '==', fuelType),
    where('active', '==', true),
    where('effectiveDate', '<=', Timestamp.fromDate(date)),
    orderBy('effectiveDate', 'desc'),
    limit(1)
  )
  const snapshot = await getDocs(q)
  if (snapshot.empty) return null
  const docSnap = snapshot.docs[0]
  return docToFuelRate(docSnap.id, docSnap.data())
}
