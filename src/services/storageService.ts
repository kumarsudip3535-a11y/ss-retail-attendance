import { getDownloadURL, ref, uploadBytes } from 'firebase/storage'
import { getFirebaseStorage } from '@/services/firebase'

/**
 * Uploads an employee's photo to Firebase Storage and returns the public
 * download URL to store in the employee's `photoUrl` field.
 *
 * Path: employee-photos/{employeeId}/photo.jpg — separate from the
 * existing /users/{userId}/ rules, since an admin uploads on behalf of
 * a different employee. See storage.rules (added in Phase T9, closing
 * out the "no storage.rules file exists" gap flagged during Phase 9).
 */
export async function uploadEmployeePhoto(
  employeeId: string,
  file: File
): Promise<string> {
  const storage = getFirebaseStorage()
  const path = `employee-photos/${employeeId}/photo.jpg`
  const photoRef = ref(storage, path)

  await uploadBytes(photoRef, file)
  return getDownloadURL(photoRef)
}

/**
 * Phase T9: uploads a travel claim receipt (fuel slip, toll receipt,
 * parking ticket, etc.) and returns its download URL, appended to the
 * claim's `receiptUrls` array by the caller. Path is keyed by employeeId
 * + claimId so storage.rules can authorize purely from the path (a
 * Storage rule can't read the claim document's own `employeeId` field
 * the way Firestore rules read `resource.data`). File name is
 * timestamp-prefixed to avoid collisions between multiple receipts on
 * the same claim.
 */
export async function uploadClaimReceipt(
  employeeId: string,
  claimId: string,
  file: File
): Promise<string> {
  const storage = getFirebaseStorage()
  const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_')
  const path = `travel-claim-receipts/${employeeId}/${claimId}/${Date.now()}_${safeName}`
  const receiptRef = ref(storage, path)

  await uploadBytes(receiptRef, file)
  return getDownloadURL(receiptRef)
}
