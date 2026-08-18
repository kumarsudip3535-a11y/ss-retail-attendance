import { useEffect, useRef, useState } from 'react'
import { faceVerificationService } from '@/services/faceVerificationService'

type CaptureStatus =
  | 'requesting-camera'
  | 'camera-error'
  | 'live'
  | 'captured'
  | 'verifying'
  | 'verify-failed'

interface FaceCaptureModalProps {
  onVerified: (imageDataUrl: string) => void
  onCancel: () => void
}

/**
 * Camera-based face capture step: Punch In -> Location Verification ->
 * [this component] -> Face Verification -> Attendance Recorded.
 * Verification itself is delegated to faceVerificationService (mock mode
 * in dev; a real provider can be swapped in there later).
 */
export default function FaceCaptureModal({
  onVerified,
  onCancel,
}: FaceCaptureModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const [status, setStatus] = useState<CaptureStatus>('requesting-camera')
  const [capturedImage, setCapturedImage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function startCamera() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus('camera-error')
        setErrorMessage('Your browser does not support camera access.')
        return
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user' },
          audio: false,
        })

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }

        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
        }
        setStatus('live')
      } catch (error) {
        if (cancelled) return
        console.error('[FaceCaptureModal] Camera access failed:', error)
        setStatus('camera-error')
        setErrorMessage('Camera permission is required for face verification.')
      }
    }

    startCamera()

    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach((track) => track.stop())
    }
  }, [])

  function handleCapture() {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return

    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9)
    setCapturedImage(dataUrl)
    setStatus('captured')
  }

  function handleRetake() {
    setCapturedImage(null)
    setStatus('live')
  }

  async function handleConfirm() {
    if (!capturedImage) return

    setStatus('verifying')
    try {
      const result = await faceVerificationService.verifyFace(capturedImage)
      if (result.success) {
        onVerified(capturedImage)
      } else {
        setStatus('verify-failed')
        setErrorMessage(result.reason)
      }
    } catch (error) {
      console.error('[FaceCaptureModal] Verification failed:', error)
      setStatus('verify-failed')
      setErrorMessage('Something went wrong. Please try again.')
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white shadow-lg p-6">
        <h2 className="text-lg font-semibold text-slate-800">
          Face Verification
        </h2>
        <p className="mt-1 text-xs text-slate-400">
          Look at the camera to confirm your identity before punching in.
        </p>

        <div className="mt-4 aspect-square w-full rounded-xl overflow-hidden bg-slate-900 relative">
          {status === 'requesting-camera' && (
            <div className="absolute inset-0 flex items-center justify-center text-white text-sm">
              Requesting camera access…
            </div>
          )}

          {status === 'camera-error' && (
            <div className="absolute inset-0 flex items-center justify-center px-4 text-center text-sm text-white">
              {errorMessage}
            </div>
          )}

          {/* Video element stays mounted (just visually hidden) once the
              stream starts, so we don't have to re-request the camera
              when the user retakes a photo. */}
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={`w-full h-full object-cover -scale-x-100 ${
              status === 'live' ? '' : 'hidden'
            }`}
          />

          {capturedImage && (status === 'captured' || status === 'verifying' || status === 'verify-failed') && (
            <img
              src={capturedImage}
              alt="Captured face"
              className="w-full h-full object-cover -scale-x-100"
            />
          )}

          {status === 'verifying' && (
            <div className="absolute inset-0 bg-black/40 flex items-center justify-center text-white text-sm">
              Verifying…
            </div>
          )}
        </div>

        <canvas ref={canvasRef} className="hidden" />

        {status === 'verify-failed' && errorMessage && (
          <p className="mt-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">
            {errorMessage}
          </p>
        )}

        <div className="mt-5 flex gap-3">
          {status === 'live' && (
            <button
              onClick={handleCapture}
              className="flex-1 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold py-2.5"
            >
              Capture
            </button>
          )}

          {status === 'captured' && (
            <>
              <button
                onClick={handleRetake}
                className="flex-1 rounded-lg border border-slate-300 text-slate-700 text-sm font-medium py-2.5 hover:bg-slate-50"
              >
                Retake
              </button>
              <button
                onClick={handleConfirm}
                className="flex-1 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold py-2.5"
              >
                Confirm
              </button>
            </>
          )}

          {status === 'verify-failed' && (
            <button
              onClick={handleRetake}
              className="flex-1 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold py-2.5"
            >
              Try Again
            </button>
          )}

          {(status === 'requesting-camera' ||
            status === 'camera-error' ||
            status === 'live' ||
            status === 'captured' ||
            status === 'verify-failed') && (
            <button
              onClick={onCancel}
              className="text-sm text-slate-400 hover:text-slate-600 px-3"
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
