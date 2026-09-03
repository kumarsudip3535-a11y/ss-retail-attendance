import { FirebaseAuthentication } from '@capacitor-firebase/authentication'
import { PhoneAuthProvider, signInWithCredential } from 'firebase/auth'
import { getFirebaseAuth } from '@/services/firebase'

/**
 * Phase T14 follow-up (login fix): Firebase's phone-auth reCAPTCHA widget
 * kept breaking inside this app's native Android WebView — first
 * `auth/invalid-app-credential` (the WebView's origin wasn't a trusted
 * domain), then "reCAPTCHA has already been rendered in this element" on
 * every retry (Google's own recaptcha script tracks which DOM nodes it's
 * already used, and that tracking survives any cleanup we do). Each fix
 * closed one failure mode but the underlying problem — a browser-oriented
 * anti-abuse widget running inside a sandboxed native WebView — kept
 * producing new ones.
 *
 * This module sidesteps the widget entirely for the native app: it uses
 * @capacitor-firebase/authentication to run phone verification through
 * Android's native Firebase Auth SDK, which verifies the app via Google
 * Play's Play Integrity API instead of a browser reCAPTCHA challenge (and
 * for a build not yet published on the Play Store, falls back to a native
 * reCAPTCHA flow that Google runs *outside* our WebView — still never the
 * broken embedded widget).
 *
 * `skipNativeAuth: true` (set in capacitor.config.ts) tells the plugin not
 * to keep its own separate native-only signed-in session. Instead, once it
 * hands us a verificationId, we finish the sign-in ourselves with the
 * Firebase JS SDK's PhoneAuthProvider.credential() + signInWithCredential()
 * — the exact same Auth instance the rest of the app already relies on
 * (AuthContext, Firestore security rules) ends up signed in, just as if
 * ConfirmationResult.confirm() (the web flow's equivalent) had run.
 *
 * Only used when nativeBackgroundTracking.ts's isNativeAndroid() is true —
 * the website (Netlify) keeps using the existing reCAPTCHA-based flow in
 * authService.ts completely unchanged; a real browser doesn't have this
 * problem.
 */

let pendingVerificationId: string | null = null

export interface NativePhoneSignInHandlers {
  /** Called once the SMS has been dispatched — move the UI to the OTP-entry screen. */
  onCodeSent: () => void
  /**
   * Called if Android auto-verifies the number without the user ever
   * entering a code (instant verification, or SMS auto-retrieval) — the
   * sign-in is already complete by the time this fires.
   */
  onAutoVerified: () => void
}

/**
 * Starts native phone verification for `e164Phone`. Resolves once the SMS
 * has been dispatched (or once auto-verification completes sign-in
 * outright); rejects with a native failure message otherwise.
 */
export async function startNativePhoneSignIn(
  e164Phone: string,
  handlers: NativePhoneSignInHandlers
): Promise<void> {
  // Tear down any listeners left over from an abandoned previous attempt
  // so a stale callback can never fire into this one.
  await FirebaseAuthentication.removeAllListeners()
  pendingVerificationId = null

  return new Promise<void>((resolve, reject) => {
    let settled = false

    FirebaseAuthentication.addListener('phoneCodeSent', (event) => {
      pendingVerificationId = event.verificationId
      if (settled) return
      settled = true
      resolve()
      handlers.onCodeSent()
    })

    FirebaseAuthentication.addListener('phoneVerificationFailed', (event) => {
      if (settled) return
      settled = true
      reject(new Error(event.message))
    })

    FirebaseAuthentication.addListener('phoneVerificationCompleted', async (event) => {
      // Instant verification with no code at all can't be bridged to the
      // JS SDK (no verificationId+code pair to build a credential from) —
      // rare in practice; let the normal manual-entry flow continue.
      const verificationId = pendingVerificationId
      if (!event.verificationCode || !verificationId) return

      try {
        const credential = PhoneAuthProvider.credential(verificationId, event.verificationCode)
        await signInWithCredential(getFirebaseAuth(), credential)
        pendingVerificationId = null
        if (settled) {
          handlers.onAutoVerified()
          return
        }
        settled = true
        resolve()
        handlers.onAutoVerified()
      } catch (error) {
        if (settled) return
        settled = true
        reject(error instanceof Error ? error : new Error('Auto-verification failed.'))
      }
    })

    FirebaseAuthentication.signInWithPhoneNumber({ phoneNumber: e164Phone }).catch((error) => {
      if (settled) return
      settled = true
      reject(error instanceof Error ? error : new Error('Failed to start phone verification.'))
    })
  })
}

/**
 * Confirms the code the user typed against the pending native
 * verification, finishing sign-in on the Firebase JS SDK's Auth instance.
 */
export async function confirmNativeOtp(code: string): Promise<void> {
  if (!pendingVerificationId) {
    throw new Error('Session expired. Please request a new OTP.')
  }
  const credential = PhoneAuthProvider.credential(pendingVerificationId, code)
  await signInWithCredential(getFirebaseAuth(), credential)
  pendingVerificationId = null
  await FirebaseAuthentication.removeAllListeners()
}

/** Cleans up in-flight native listeners/state — call on unmount or before restarting. */
export async function teardownNativePhoneSignIn(): Promise<void> {
  pendingVerificationId = null
  await FirebaseAuthentication.removeAllListeners()
}
