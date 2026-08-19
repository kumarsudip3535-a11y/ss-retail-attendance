import {
  RecaptchaVerifier,
  signInWithPhoneNumber,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  type ConfirmationResult,
  type User,
} from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { getFirebaseAuth, getFirebaseDb } from '@/services/firebase'
import type { Employee, ReimbursementMethod } from '@/types'

const INDIA_COUNTRY_CODE = '+91'

// Mirrors employeeService.ts's DEFAULT_ALLOWED_REIMBURSEMENT_METHODS — kept
// as a separate local constant rather than a shared export since the two
// services don't otherwise depend on each other, but the fallback value
// itself must stay in sync: an employee record saved before Phase T8 has
// no `allowedReimbursementMethods` field in Firestore at all, and both
// this lookup and employeeService's own reads need to default it the same
// way for a first-time login to see the same allowed methods a
// getAllEmployees() call would.
const DEFAULT_ALLOWED_REIMBURSEMENT_METHODS: ReimbursementMethod[] = ['fuel_mileage']

// Phase T14: mirrors employeeService.ts's own DEFAULT_TRACKING_ENABLED —
// same "two independent mapping functions, must default identically"
// reasoning as the reimbursement-methods constant above. Must be `true`:
// an employee record saved before this phase has no `trackingEnabled`
// field at all, and defaulting to `false` here would silently turn
// tracking off for a real employee's very next login.
const DEFAULT_TRACKING_ENABLED = true

/**
 * Normalizes a 10-digit Indian mobile number (or one already prefixed
 * with +91) into E.164 format, e.g. "9905719715" -> "+919905719715".
 */
export function toE164IndianPhone(rawInput: string): string {
  const digitsOnly = rawInput.replace(/\D/g, '')

  if (rawInput.trim().startsWith('+')) {
    return `+${digitsOnly}`
  }

  // Strip a leading "91" if the user typed it without the +
  const last10 = digitsOnly.slice(-10)
  return `${INDIA_COUNTRY_CODE}${last10}`
}

/**
 * Creates an invisible reCAPTCHA verifier bound to a container element.
 * Must be called once, after the container element exists in the DOM,
 * before sendOtp(). Callers are responsible for calling .clear() on
 * unmount to avoid duplicate widgets.
 */
export function createRecaptchaVerifier(
  containerId: string
): RecaptchaVerifier {
  const auth = getFirebaseAuth()
  return new RecaptchaVerifier(auth, containerId, {
    size: 'invisible',
  })
}

/**
 * Sends an OTP to the given phone number. Returns a ConfirmationResult
 * that must be passed to verifyOtp() along with the code the user enters.
 */
export async function sendOtp(
  phoneNumber: string,
  recaptchaVerifier: RecaptchaVerifier
): Promise<ConfirmationResult> {
  const auth = getFirebaseAuth()
  const e164Phone = toE164IndianPhone(phoneNumber)
  return signInWithPhoneNumber(auth, e164Phone, recaptchaVerifier)
}

/**
 * Confirms the OTP code against the pending ConfirmationResult from
 * sendOtp(). Resolves with the authenticated Firebase User on success.
 */
export async function verifyOtp(
  confirmationResult: ConfirmationResult,
  code: string
): Promise<User> {
  const credential = await confirmationResult.confirm(code)
  return credential.user
}

export async function signOut(): Promise<void> {
  const auth = getFirebaseAuth()
  await firebaseSignOut(auth)
}

/**
 * Subscribes to Firebase auth state changes. Returns an unsubscribe
 * function — call it in a useEffect cleanup.
 */
export function subscribeToAuthChanges(
  callback: (user: User | null) => void
): () => void {
  const auth = getFirebaseAuth()
  return onAuthStateChanged(auth, callback)
}

/**
 * Looks up the current employee record for the given authenticated phone
 * number, via the employeeLookup/{phone} index (see Phase 12) rather than
 * a query on the employees collection. This matters because Firestore
 * security rules can only verify direct, specific document reads — a
 * query filtered on a non-ID field like `phone` can't be proven safe for
 * a non-admin user under rules that check "is this your own document".
 * Returns null if no employee record exists (i.e. an unregistered number
 * successfully authenticated with Firebase but isn't in our system yet).
 */
export async function findEmployeeByPhone(
  phone: string
): Promise<Employee | null> {
  const db = getFirebaseDb()

  const lookupSnap = await getDoc(doc(db, 'employeeLookup', phone))
  if (!lookupSnap.exists()) {
    return null
  }

  const employeeDocId = lookupSnap.data().employeeDocId as string
  const employeeSnap = await getDoc(doc(db, 'employees', employeeDocId))
  if (!employeeSnap.exists()) {
    return null
  }

  const data = employeeSnap.data()

  return {
    id: employeeSnap.id,
    name: data.name,
    employeeId: data.employeeId,
    phone: data.phone,
    officeLat: data.officeLat,
    officeLng: data.officeLng,
    geofenceRadius: data.geofenceRadius,
    role: data.role,
    photoUrl: data.photoUrl ?? '',
    disabled: data.disabled ?? false,
    assignedVehicleId: data.assignedVehicleId ?? null,
    allowedReimbursementMethods:
      (data.allowedReimbursementMethods as ReimbursementMethod[] | undefined) ??
      DEFAULT_ALLOWED_REIMBURSEMENT_METHODS,
    baseSalary: (data.baseSalary as number | undefined) ?? 0,
    trackingEnabled: (data.trackingEnabled as boolean | undefined) ?? DEFAULT_TRACKING_ENABLED,
    email: (data.email as string | null | undefined) ?? null,
  }
}
