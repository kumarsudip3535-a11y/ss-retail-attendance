/**
 * Abstraction over face verification so a real provider (Luxand, Face++,
 * AWS Rekognition, etc.) can be dropped in later without touching any
 * calling code. Only verifyFace() needs to change — everything else in
 * the app just calls that function and reacts to the result shape below.
 */

export type FaceVerificationResult =
  | { success: true; confidence: number }
  | { success: false; reason: string }

export interface FaceVerificationService {
  verifyFace(imageDataUrl: string): Promise<FaceVerificationResult>
}

/**
 * Development/mock implementation. Always succeeds after a short simulated
 * delay, as long as an image was actually captured. Swap this out for a
 * real provider by implementing the same interface and changing the
 * export at the bottom of this file — no other code needs to change.
 */
class MockFaceVerificationService implements FaceVerificationService {
  async verifyFace(imageDataUrl: string): Promise<FaceVerificationResult> {
    if (!imageDataUrl || !imageDataUrl.startsWith('data:image')) {
      return { success: false, reason: 'No image was captured.' }
    }

    // Simulate network latency of a real verification API call.
    await new Promise((resolve) => setTimeout(resolve, 800))

    return { success: true, confidence: 0.99 }
  }
}

/*
 * --- Wiring a real provider later (reference only) ---
 *
 * class LuxandFaceVerificationService implements FaceVerificationService {
 *   async verifyFace(imageDataUrl: string): Promise<FaceVerificationResult> {
 *     const response = await fetch('https://api.luxand.cloud/photo/verify', {
 *       method: 'POST',
 *       headers: { token: import.meta.env.VITE_LUXAND_API_KEY },
 *       body: buildFormData(imageDataUrl),
 *     })
 *     const data = await response.json()
 *     return data.probability > 0.9
 *       ? { success: true, confidence: data.probability }
 *       : { success: false, reason: 'Face did not match employee record.' }
 *   }
 * }
 *
 * Then change the export below to:
 *   export const faceVerificationService: FaceVerificationService =
 *     new LuxandFaceVerificationService()
 */

export const faceVerificationService: FaceVerificationService =
  new MockFaceVerificationService()
