import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import type { RecaptchaVerifier, ConfirmationResult } from 'firebase/auth'
import {
  createRecaptchaVerifier,
  sendOtp,
  verifyOtp,
} from '@/services/authService'
import { useAuth } from '@/context/AuthContext'

const RECAPTCHA_CONTAINER_ID = 'recaptcha-container'

type Step = 'phone' | 'otp'

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
  const recaptchaReadyRef = useRef<Promise<unknown> | null>(null)

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

  // Create and render the reCAPTCHA widget when the login screen mounts,
  // and clean it up when it unmounts (e.g. navigating away after login,
  // or back to this screen later) so a stale widget never lingers.
  useEffect(() => {
    const verifier = createRecaptchaVerifier(RECAPTCHA_CONTAINER_ID)
    recaptchaVerifierRef.current = verifier
    recaptchaReadyRef.current = verifier.render()

    return () => {
      recaptchaVerifierRef.current?.clear()
      recaptchaVerifierRef.current = null
      recaptchaReadyRef.current = null
    }
  }, [])

  async function handleSendOtp() {
    setErrorMessage(null)

    const digitsOnly = phone.replace(/\D/g, '')
    if (digitsOnly.length < 10) {
      setErrorMessage('Enter a valid 10-digit mobile number.')
      return
    }

    setSubmitting(true)
    try {
      if (!recaptchaVerifierRef.current || !recaptchaReadyRef.current) {
        throw new Error('reCAPTCHA is not ready yet. Please wait a moment and try again.')
      }
      await recaptchaReadyRef.current
      const confirmation = await sendOtp(phone, recaptchaVerifierRef.current)
      confirmationResultRef.current = confirmation
      setStep('otp')
      toast.success('OTP sent to your mobile number.')
    } catch (error) {
      console.error('[LoginPage] sendOtp failed:', error)
      setErrorMessage('Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleVerifyOtp() {
    setErrorMessage(null)

    if (otp.trim().length < 6) {
      setErrorMessage('Enter the 6-digit code sent to your phone.')
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
      setErrorMessage('Incorrect OTP. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  function handleChangeNumber() {
    setStep('phone')
    setOtp('')
    setErrorMessage(null)
    confirmationResultRef.current = null
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white shadow-sm border border-slate-200 p-8">
        <img
          src="/logo.svg"
          alt="SS Retail Services"
          className="h-10 w-auto mx-auto block"
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
              className="w-full rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-medium py-2.5 transition-colors"
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
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500 tracking-widest"
              />
              <p className="mt-1 text-xs text-slate-400">
                Sent to +91 {phone}
              </p>
            </div>

            <button
              onClick={handleVerifyOtp}
              disabled={submitting}
              className="w-full rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-medium py-2.5 transition-colors"
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

        {/* Invisible reCAPTCHA anchor required by Firebase Phone Auth */}
        <div id={RECAPTCHA_CONTAINER_ID} />
      </div>
    </div>
  )
}
