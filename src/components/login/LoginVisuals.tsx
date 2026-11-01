/**
 * Small animated pieces for the login screen. Pure SVG + CSS (classes in
 * index.css under "Login & OTP animations") — no extra libraries.
 */

/** A phone that receives an SMS bubble (typing dots → code), then a check when verified. */
export function SmsIllustration({ verified = false }: { verified?: boolean }) {
  return (
    <div className={`sms-phone ${verified ? 'is-verified' : ''}`} aria-hidden="true">
      <svg viewBox="0 0 64 88" className="sms-phone-svg">
        <defs>
          <linearGradient id="smsPhoneBody" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#6366f1" />
            <stop offset="1" stopColor="#0ea5e9" />
          </linearGradient>
        </defs>
        <rect x="6" y="2" width="52" height="84" rx="10" fill="url(#smsPhoneBody)" />
        <rect x="10" y="10" width="44" height="66" rx="5" fill="#f8fafc" />
        <rect x="26" y="5" width="12" height="2" rx="1" fill="#c7d2fe" />
        <circle cx="32" cy="81" r="2.2" fill="#c7d2fe" />
      </svg>
      <div className="sms-bubble">
        <span className="sms-dots">
          <i />
          <i />
          <i />
        </span>
        <span className="sms-code">• • • • • •</span>
      </div>
      <div className="sms-check">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      </div>
      <span className="sms-ping" />
    </div>
  )
}

/** Circular countdown for "Resend code in Ns". */
export function ResendRing({ remaining, total }: { remaining: number; total: number }) {
  const r = 8
  const c = 2 * Math.PI * r
  const progress = Math.max(0, Math.min(1, remaining / total))
  return (
    <svg viewBox="0 0 20 20" className="h-5 w-5 -rotate-90" aria-hidden="true">
      <circle cx="10" cy="10" r={r} fill="none" stroke="#e0e7ff" strokeWidth="2.5" />
      <circle
        cx="10"
        cy="10"
        r={r}
        fill="none"
        stroke="#6366f1"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - progress)}
        style={{ transition: 'stroke-dashoffset 1s linear' }}
      />
    </svg>
  )
}

/** Drawn check mark with a confetti-style ring burst, shown after a correct OTP. */
export function SuccessBurst() {
  return (
    <div className="success-burst" role="status">
      <div className="success-disc">
        <svg viewBox="0 0 52 52" className="success-check">
          <circle cx="26" cy="26" r="24" fill="none" />
          <path fill="none" d="M15 27l7 7 15-16" />
        </svg>
        {Array.from({ length: 10 }, (_, i) => (
          <span key={i} className="success-spark" style={{ ['--a' as string]: `${i * 36}deg` }} />
        ))}
      </div>
      <p className="mt-3 text-sm font-semibold text-emerald-700">OTP verified — opening your dashboard</p>
    </div>
  )
}

export function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.3" strokeWidth="3" />
      <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

/** "1 Mobile — 2 Verify" progress indicator. */
export function StepDots({ step }: { step: 1 | 2 }) {
  return (
    <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider" aria-label={`Step ${step} of 2`}>
      <span className={`step-dot ${step >= 1 ? 'is-on' : ''}`}>1</span>
      <span className={`step-bar ${step >= 2 ? 'is-on' : ''}`} />
      <span className={`step-dot ${step >= 2 ? 'is-on' : ''}`}>2</span>
    </div>
  )
}
