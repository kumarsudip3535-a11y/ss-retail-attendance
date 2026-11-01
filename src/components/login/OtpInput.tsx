import { useEffect, useRef } from 'react'

export type OtpVisualState = 'idle' | 'error' | 'success'

interface OtpInputProps {
  value: string
  onChange: (value: string) => void
  /** Called once all digits are filled (typed or pasted). */
  onComplete?: (value: string) => void
  length?: number
  disabled?: boolean
  state?: OtpVisualState
  autoFocus?: boolean
}

/**
 * Six separate digit boxes for the OTP step.
 *
 * - Each box drops in with a staggered 3D flip; a typed digit flips in.
 * - Paste (or SMS autofill via autocomplete="one-time-code", which some
 *   keyboards drop into the first field) spreads digits across the boxes.
 * - Backspace on an empty box jumps back; arrow keys move between boxes.
 * - `state="error"` shakes the row red, `state="success"` runs a green wave.
 */
export default function OtpInput({
  value,
  onChange,
  onComplete,
  length = 6,
  disabled = false,
  state = 'idle',
  autoFocus = true,
}: OtpInputProps) {
  const inputs = useRef<(HTMLInputElement | null)[]>([])
  const digits = Array.from({ length }, (_, i) => value[i] ?? '')

  useEffect(() => {
    if (autoFocus) inputs.current[0]?.focus()
  }, [autoFocus])

  // After an error, put the cursor back on the first box so the user can retype.
  useEffect(() => {
    if (state === 'error') inputs.current[0]?.select()
  }, [state])

  function commit(next: string) {
    const clean = next.replace(/\D/g, '').slice(0, length)
    onChange(clean)
    if (clean.length === length) onComplete?.(clean)
    return clean
  }

  function handleChange(index: number, raw: string) {
    const typed = raw.replace(/\D/g, '')
    if (!typed) return
    if (typed.length > 1) {
      // Paste / autofill of several digits into one box.
      const merged = (value.slice(0, index) + typed).slice(0, length)
      const clean = commit(merged)
      inputs.current[Math.min(clean.length, length - 1)]?.focus()
      return
    }
    const arr = digits.slice()
    arr[index] = typed
    const clean = commit(arr.join('').slice(0, length))
    if (index < length - 1 && clean.length > index) inputs.current[index + 1]?.focus()
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace') {
      e.preventDefault()
      const arr = digits.slice()
      if (arr[index]) {
        arr[index] = ''
        onChange(arr.join(''))
      } else if (index > 0) {
        arr[index - 1] = ''
        onChange(arr.join(''))
        inputs.current[index - 1]?.focus()
      }
    } else if (e.key === 'ArrowLeft' && index > 0) {
      inputs.current[index - 1]?.focus()
    } else if (e.key === 'ArrowRight' && index < length - 1) {
      inputs.current[index + 1]?.focus()
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData('text').replace(/\D/g, '')
    if (!text) return
    e.preventDefault()
    const clean = commit(text)
    inputs.current[Math.min(clean.length, length - 1)]?.focus()
  }

  return (
    <div
      className={`otp-row ${state === 'error' ? 'otp-row--error' : ''} ${state === 'success' ? 'otp-row--success' : ''}`}
      role="group"
      aria-label="One-time password"
    >
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            inputs.current[i] = el
          }}
          className={`otp-box ${d ? 'is-filled' : ''}`}
          style={{ animationDelay: `${i * 60}ms`, ['--wave-delay' as string]: `${i * 70}ms` }}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={i === 0 ? length : 1}
          // Lets Android/iOS keyboards offer the code from the SMS as a
          // one-tap suggestion; it lands in the first box and is spread out.
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          aria-label={`Digit ${i + 1}`}
          value={d}
          disabled={disabled}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={handlePaste}
          onFocus={(e) => e.target.select()}
        />
      ))}
    </div>
  )
}
