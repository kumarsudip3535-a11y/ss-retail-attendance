import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import type { RecaptchaVerifier, ConfirmationResult } from 'firebase/auth'
import {
  createRecaptchaVerifier,
  sendOtp,
  verifyOtp,
  toE164IndianPhone,
} from '@/services/authService'
import { isNativeAndroid } from '@/services/platform'
import {
  startNativePhoneSignIn,
  confirmNativeOtp,
  teardownNativePhoneSignIn,
} from '@/services/nativePhoneAuth'
import { useAuth } from '@/context/AuthContext'

type Step = 'phone' | 'otp'

/**
 * Maps a Firebase phone-auth completion error to a message that matches
 * what actually happened, instead of always saying "Incorrect OTP" (see
 * handleVerifyOtp's original comment history). Shared between the web
 * path (verifyOtp -> ConfirmationResult.confirm()) and the native path
 * (confirmNativeOtp -> signInWithCredential()) since both are ultimately
 * the same Firebase JS SDK call underneath and throw the same error codes.
 */
function mapVerifyOtpError(error: unknown): string {
  const code = (error as { code?: string })?.code
  if (code === 'auth/code-expired') {
    return 'This code has expired. Please request a new OTP.'
  }
  if (code === 'auth/too-many-requests') {
    return 'Too many attempts. Please wait a bit before trying again.'
  }
  if (code === 'auth/network-request-failed') {
    return 'Network error — check your connection and try again.'
  }
  if (code === 'auth/invalid-verification-code') {
    return 'Incorrect OTP. Please check the code and try again.'
  }
  return 'Something went wrong verifying the code. Please try again.'
}

export default function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { firebaseUser, employee, loading, isUnregistered } = useAuth()

  const [step, setStep] = useState<Step>('phone')
  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const confirmationResultRef = useRef<ConfirmationResult | null>(null)
  const recaptchaVerifierRef = useRef<RecaptchaVerifier | null>(null)
  // Stable wrapper element that we imperatively add/remove a fresh child
  // node to/from on every attempt — see teardownRecaptcha/createFreshVerifier.
  const recaptchaHostRef = useRef<HTMLDivElement | null>(null)
  // Guards against a double-tap firing handleSendOtp twice before the
  // `submitting` state re-render has a chance to disable the button —
  // two concurrent attempts would both try to render into a fresh node
  // and race each other.
  const sendInFlightRef = useRef(false)

  // Redirect a fully authenticated, registered employee to the right
  // dashboard as soon as AuthContext resolves their record.
  useEffect(() => {
    if (loading) return
    if (firebaseUser && employee) {
      navigate(employee.role === 'admin' ? '/admin' : '/dashboard', {
        replace: true,
      })
    }
  }, [loading, firebaseUser, employee, navigate])

  // Surface the "not registered" message if we got redirected back here
  // from ProtectedRoute, or if AuthContext just determined this directly.
  useEffect(() => {
    if (!loading && firebaseUser && isUnregistered) {
      setErrorMessage(
        'Your mobile number is not registered. Please contact the administrator.'
      )
    }
  }, [loading, firebaseUser, isUnregistered])

  useEffect(() => {
    const state = location.state as { unregistered?: boolean } | null
    if (state?.unregistered) {
      setErrorMessage(
        'Your mobile number is not registered. Please contact the administrator.'
      )
    }
  }, [location.state])

  // Tears down whatever reCAPTCHA state exists right now: releases
  // Firebase's own verifier instance, then wipes every child out of the
  // host element. The innerHTML wipe matters even though verifier.clear()
  // already empties the DOM — Google's underlying grecaptcha script keeps
  // its own separate internal registry of "which DOM elements already
  // have a widget rendered into them," and that registry survives
  // Firebase's own .clear() call. Re-rendering into the *same* physical
  // DOM node a second time throws "reCAPTCHA has already been rendered in
  // this element" even from a brand-new RecaptchaVerifier instance — the
  // only reliable fix is to never reuse the same DOM node twice.
  function teardownRecaptcha() {
    recaptchaVerifierRef.current?.clear()
    recaptchaVerifierRef.current = null
    if (recaptchaHostRef.current) {
      recaptchaHostRef.current.innerHTML = ''
    }
  }

  // Builds and renders a completely fresh reCAPTCHA widget, on a brand
  // new child DOM node created for this attempt only. Called at the start
  // of every single Send OTP attempt — never reuse a widget or its node
  // across attempts. See teardownRecaptcha's comment for why.
  async function createFreshVerifier(): Promise<RecaptchaVerifier> {
    teardownRecaptcha()

    const freshNode = document.createElement('div')
    freshNode.id = `recaptcha-slot-${Date.now()}-${Math.random().toString(36).slice(2)}`
    recaptchaHostRef.current?.appendChild(freshNode)

    const verifier = createRecaptchaVerifier(freshNode.id)
    recaptchaVerifierRef.current = verifier
    await verifier.render()
    return verifier
  }

  // Clean up on unmount (e.g. navigating away after login).
  useEffect(() => {
    return () => {
      if (isNativeAndroid()) {
        teardownNativePhoneSignIn()
      } else {
        teardownRecaptcha()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleSendOtp() {
    if (sendInFlightRef.current) return

    setErrorMessage(null)

    const digitsOnly = phone.replace(/\D/g, '')
    if (digitsOnly.length < 10) {
      setErrorMessage('Enter a valid 10-digit mobile number.')
      return
    }

    sendInFlightRef.current = true
    setSubmitting(true)
    try {
      if (isNativeAndroid()) {
        // Native Android: verification runs through Google Play Integrity
        // (or a native reCAPTCHA fallback outside our WebView) instead of
        // the browser-oriented widget — see nativePhoneAuth.ts for why.
        await startNativePhoneSignIn(toE164IndianPhone(phone), {
          onCodeSent: () => {
            setStep('otp')
            toast.success('OTP sent to your mobile number.')
          },
          onAutoVerified: () => {
            // Android confirmed the number without any code entry —
            // AuthContext's onAuthStateChanged listener picks this up and
            // the redirect effect above navigates on once ready.
            toast.success('Verified automatically.')
          },
        })
      } else {
        const verifier = await createFreshVerifier()
        const confirmation = await sendOtp(phone, verifier)
        confirmationResultRef.current = confirmation
        setStep('otp')
        toast.success('OTP sent to your mobile number.')
      }
    } catch (error) {
      console.error('[LoginPage] sendOtp failed:', error)
      // Tear down whatever might be left in a corrupted/half-started state
      // so the *next* attempt starts completely clean.
      if (isNativeAndroid()) {
        await teardownNativePhoneSignIn()
      } else {
        teardownRecaptcha()
      }
      setErrorMessage('Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
      sendInFlightRef.current = false
    }
  }

  async function handleVerifyOtp() {
    setErrorMessage(null)

    if (otp.trim().length < 6) {
      setErrorMessage('Enter the 6-digit code sent to your phone.')
      return
    }

    if (isNativeAndroid()) {
      setSubmitting(true)
      try {
        await confirmNativeOtp(otp.trim())
        // AuthContext's onAuthStateChanged listener picks this up and the
        // redirect effect above handles navigation once the employee
        // lookup resolves.
      } catch (error) {
        console.error('[LoginPage] native verifyOtp failed:', error)
        setErrorMessage(mapVerifyOtpError(error))
      } finally {
        setSubmitting(false)
      }
      return
    }

    if (!confirmationResultRef.current) {
      setErrorMessage('Session expired. Please request a new OTP.')
      setStep('phone')
      return
    }

    setSubmitting(true)
    try {
      await verifyOtp(confirmationResultRef.current, otp.trim())
      // AuthContext's onAuthStateChanged listener picks this up and the
      // redirect effect above handles navigation once the employee
      // lookup resolves.
    } catch (error) {
      console.error('[LoginPage] verifyOtp failed:', error)
      // Previously this always showed "Incorrect OTP", even when the real
      // cause was something else entirely — see mapVerifyOtpError.
      setErrorMessage(mapVerifyOtpError(error))
    } finally {
      setSubmitting(false)
    }
  }

  function handleChangeNumber() {
    setStep('phone')
    setOtp('')
    setErrorMessage(null)
    confirmationResultRef.current = null
    if (isNativeAndroid()) {
      teardownNativePhoneSignIn()
    }
  }

  return (
    <div className="min-h-screen px-4 sm:px-8 lg:px-20 pt-[34vh] pb-10 sm:pt-[38vh] lg:py-10 flex flex-col items-center lg:items-start lg:justify-center gap-8">
      {/* Copy column — on large screens the 3D route globe (Background3D,
          'hero' variant) fills the right half of the viewport. */}
      <div className="hidden lg:block max-w-md login-card-3d [animation-delay:0.15s]">
        <p className="inline-flex items-center gap-2 rounded-full bg-white/70 backdrop-blur px-3 py-1 text-xs font-semibold text-emerald-700 border border-white/80 shadow-sm">
          <span className="h-2 w-2 rounded-full bg-emerald-500 live-dot-3d" />
          Live field tracking
        </p>
        <h1 className="mt-4 text-4xl xl:text-5xl font-extrabold leading-[1.05] tracking-tight text-slate-900">
          Every shift.
          <br />
          Every stop.
          <br />
          <span className="text-gradient-3d">Every kilometre.</span>
        </h1>
        <p className="mt-4 text-sm text-slate-500 max-w-sm">
          Attendance, live GPS routes and travel claims for SS Retail Services field teams — in one place.
        </p>
        <div className="mt-5 grid grid-cols-3 gap-3 max-w-sm">
          {[
            ['GPS', 'Punch-in geofence'],
            ['Live', 'Route & distance'],
            ['₹', 'Auto travel claims'],
          ].map(([big, small]) => (
            <div key={small} className="tilt-tile rounded-xl bg-white/70 backdrop-blur border border-white/80 px-3 py-3 shadow-[0_10px_24px_-14px_rgba(49,46,129,0.4)]">
              <p className="text-lg font-bold text-indigo-600">{big}</p>
              <p className="text-[11px] leading-tight text-slate-500">{small}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="w-full max-w-sm">
      <div className="w-full login-card-3d card-3d rounded-3xl bg-white shadow-sm border border-slate-200 p-8">
        <img
          src="/logo.svg"
          alt="SS Retail Services"
          className="h-10 w-auto mx-auto block drop-shadow-[0_6px_12px_rgba(67,56,202,0.25)]"
        />
        <p className="mt-2 text-sm text-slate-500 text-center">
          Employee Attendance Management System
        </p>

        {errorMessage && (
          <div className="mt-5 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">
            {errorMessage}
          </div>
        )}

        {step === 'phone' && (
          <div className="mt-6 space-y-4">
            <div>
              <label
                htmlFor="phone"
                className="block text-sm font-medium text-slate-700 mb-1"
              >
                Mobile Number
              </label>
              <div className="flex rounded-lg border border-slate-300 overflow-hidden focus-within:ring-2 focus-within:ring-brand-500">
                <span className="px-3 py-2 bg-slate-50 text-slate-500 text-sm border-r border-slate-300">
                  +91
                </span>
                <input
                  id="phone"
                  type="tel"
                  inputMode="numeric"
                  maxLength={10}
                  placeholder="98765 43210"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="flex-1 px-3 py-2 text-sm outline-none"
                />
              </div>
            </div>

            <button
              onClick={handleSendOtp}
              disabled={submitting}
              className="btn-3d w-full rounded-xl bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-semibold py-3"
            >
              {submitting ? 'Sending…' : 'Send OTP'}
            </button>
          </div>
        )}

        {step === 'otp' && (
          <div className="mt-6 space-y-4">
            <div>
              <label
                htmlFor="otp"
                className="block text-sm font-medium text-slate-700 mb-1"
              >
                Enter OTP
              </label>
              <input
                id="otp"
                type="text"
                inputMode="numeric"
                maxLength={6}
                placeholder="123456"
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                // Lets mobile browsers offer the *actual latest* SMS code
                // as a one-tap autofill suggestion, instead of the person
                // manually switching to Messages and copying a code by
                // hand — which is an easy way to accidentally copy an
                // older OTP still sitting in the thread from a previous
                // attempt and paste in a code that's already expired.
                autoComplete="one-time-code"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500 tracking-widest"
              />
              <p className="mt-1 text-xs text-slate-400">
                Sent to +91 {phone}
              </p>
            </div>

            <button
              onClick={handleVerifyOtp}
              disabled={submitting}
              className="btn-3d w-full rounded-xl bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-semibold py-3"
            >
              {submitting ? 'Verifying…' : 'Verify OTP'}
            </button>

            <button
              onClick={handleChangeNumber}
              className="w-full text-xs text-slate-400 hover:text-slate-600"
            >
              Use a different number
            </button>
          </div>
        )}

        {/* Invisible reCAPTCHA anchor required by Firebase Phone Auth —
            a stable wrapper; the actual widget node is created fresh
            inside it on every attempt (see createFreshVerifier). */}
        <div ref={recaptchaHostRef} />

        {/* Only shown on the plain website — pointless (and confusing)
            inside the native Android app itself, since that IS the app. */}
        {!isNativeAndroid() && (
          <a
            href="/downloads/ss-retail-attendance.apk"
            className="mt-6 block text-center text-xs text-brand-600 hover:text-brand-700 underline underline-offset-2"
          >
            Download Android App (APK)
          </a>
        )}
      </div>
      </div>
    </div>
  )
}
