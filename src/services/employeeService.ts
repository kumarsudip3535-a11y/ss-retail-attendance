import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  setDoc,
  updateDoc,
} from 'firebase/firestore'
import { getFirebaseDb } from '@/services/firebase'
import type { Employee, EmployeeFormInput, ReimbursementMethod } from '@/types'

const LOOKUP_COLLECTION = 'employeeLookup'
const EMPLOYEES_COLLECTION = 'employees'

/**
 * Phase T8 default — any employee record saved before this phase (or
 * created without explicitly setting the field) is treated as allowed
 * only "Fuel + Mileage", the safest/simplest method, until an admin
 * opens Employee Management and grants more.
 */
const DEFAULT_ALLOWED_REIMBURSEMENT_METHODS: ReimbursementMethod[] = ['fuel_mileage']

/**
 * Phase T14 default — see Employee.trackingEnabled's doc comment. Any
 * employee record saved before this phase has no `trackingEnabled` field
 * in Firestore at all, and must default to `true` (module stays on for
 * everyone already using it) rather than `false` (which would read as
 * "pilot group, opt-in" and silently disable tracking for real employees
 * mid-flight).
 */
const DEFAULT_TRACKING_ENABLED = true

/**
 * Fetches every employee record, sorted by name. Used by admin screens
 * that need the full roster (dashboard summary, employee management).
 */
export async function getAllEmployees(): Promise<Employee[]> {
  const db = getFirebaseDb()
  const employeesRef = collection(db, EMPLOYEES_COLLECTION)
  const q = query(employeesRef, orderBy('name'))

  const snapshot = await getDocs(q)
  return snapshot.docs.map((docSnap) => {
    const data = docSnap.data()
    return {
      id: docSnap.id,
      name: data.name,
      employeeId: data.employeeId,
      phone: data.phone,
      officeLat: data.officeLat,
      officeLng: data.officeLng,
      geofenceRadius: data.geofenceRadius,
      role: data.role,
      photoUrl: data.photoUrl ?? '',
      disabled: data.disabled ?? false,
      // Was missing from this function entirely until Phase T14 (present
      // in authService.ts's own copy of this mapping the whole time) —
      // harmless so far since nothing read it, but worth fixing for
      // consistency now that a second field needs the same "confirm
      // existing docs gracefully default" treatment.
      assignedVehicleId: (data.assignedVehicleId as string | null | undefined) ?? null,
      allowedReimbursementMethods:
        (data.allowedReimbursementMethods as ReimbursementMethod[] | undefined) ??
        DEFAULT_ALLOWED_REIMBURSEMENT_METHODS,
      baseSalary: (data.baseSalary as number | undefined) ?? 0,
      trackingEnabled: (data.trackingEnabled as boolean | undefined) ?? DEFAULT_TRACKING_ENABLED,
    } as Employee
  })
}

/**
 * Fetches a single employee by their Firestore document ID. Used by
 * screens that only have an employeeId to work with — e.g. Route Replay
 * (Phase T5), which resolves the employee behind a tracking session so
 * an admin knows whose day they're replaying. Returns null if the
 * employee doesn't exist (or the caller isn't authorized to read it —
 * Firestore rules deny before this ever throws a useful error).
 */
export async function getEmployeeById(id: string): Promise<Employee | null> {
  const db = getFirebaseDb()
  const snap = await getDoc(doc(db, EMPLOYEES_COLLECTION, id))
  if (!snap.exists()) return null

  const data = snap.data()
  return {
    id: snap.id,
    name: data.name,
    employeeId: data.employeeId,
    phone: data.phone,
    officeLat: data.officeLat,
    officeLng: data.officeLng,
    geofenceRadius: data.geofenceRadius,
    role: data.role,
    photoUrl: data.photoUrl ?? '',
    disabled: data.disabled ?? false,
    assignedVehicleId: (data.assignedVehicleId as string | null | undefined) ?? null,
    allowedReimbursementMethods:
      (data.allowedReimbursementMethods as ReimbursementMethod[] | undefined) ??
      DEFAULT_ALLOWED_REIMBURSEMENT_METHODS,
    baseSalary: (data.baseSalary as number | undefined) ?? 0,
    trackingEnabled: (data.trackingEnabled as boolean | undefined) ?? DEFAULT_TRACKING_ENABLED,
  } as Employee
}

/**
 * Creates a new employee record, and maintains the employeeLookup/{phone}
 * index used by Firestore security rules to resolve "who am I" from a
 * signed-in phone number to an employee document. See Phase 12 notes.
 */
export async function createEmployee(
  data: EmployeeFormInput
): Promise<string> {
  const db = getFirebaseDb()
  const docRef = await addDoc(collection(db, EMPLOYEES_COLLECTION), data)
  await setDoc(doc(db, LOOKUP_COLLECTION, data.phone), {
    employeeDocId: docRef.id,
  })
  return docRef.id
}

/**
 * Updates an existing employee record. If the phone number is changing,
 * keeps the employeeLookup index in sync (removes the old entry, adds
 * the new one) so security rules keep resolving correctly.
 */
export async function updateEmployee(
  id: string,
  data: Partial<EmployeeFormInput>
): Promise<void> {
  const db = getFirebaseDb()

  if (data.phone) {
    const existingSnap = await getDoc(doc(db, EMPLOYEES_COLLECTION, id))
    const existingPhone = existingSnap.data()?.phone as string | undefined

    if (existingPhone && existingPhone !== data.phone) {
      await deleteDoc(doc(db, LOOKUP_COLLECTION, existingPhone))
    }
    await setDoc(doc(db, LOOKUP_COLLECTION, data.phone), {
      employeeDocId: id,
    })
  }

  await updateDoc(doc(db, EMPLOYEES_COLLECTION, id), data)
}

/** Soft-disables (or re-enables) an employee — does not delete the record. */
export async function setEmployeeDisabled(
  id: string,
  disabled: boolean
): Promise<void> {
  await updateEmployee(id, { disabled })
}
