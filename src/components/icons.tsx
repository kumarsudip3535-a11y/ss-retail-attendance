// Minimal inline icon set (no external icon library needed).
type IconProps = { className?: string }

export function HomeIcon({ className = 'h-5 w-5' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M3 11.5L12 4l9 7.5M5 10v9a1 1 0 001 1h4v-6h4v6h4a1 1 0 001-1v-9"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function ClockIcon({ className = 'h-5 w-5' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M12 7.5V12l3 2"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function UserIcon({ className = 'h-5 w-5' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M4.5 20c1.2-3.5 4.2-5.5 7.5-5.5s6.3 2 7.5 5.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function UsersIcon({ className = 'h-5 w-5' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <circle cx="9" cy="8" r="3" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M3.5 19c.9-2.8 3-4.5 5.5-4.5s4.6 1.7 5.5 4.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <circle cx="17" cy="9" r="2.3" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M15.5 14.7c1.9.2 3.4 1.6 4 3.8"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function ChartIcon({ className = 'h-5 w-5' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M4 20V10M10 20V4M16 20v-7M4 20h16"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function SettingsIcon({ className = 'h-5 w-5' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <line x1="4" y1="7" x2="20" y2="7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="9" cy="7" r="2" stroke="currentColor" strokeWidth="1.8" />
      <line x1="4" y1="12" x2="20" y2="12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="16" cy="12" r="2" stroke="currentColor" strokeWidth="1.8" />
      <line x1="4" y1="17" x2="20" y2="17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="11" cy="17" r="2" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  )
}

export function TruckIcon({ className = 'h-5 w-5' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M3 7h10v9H3z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M13 10h4l3 3v3h-7z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx="7" cy="18.5" r="1.8" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="17" cy="18.5" r="1.8" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  )
}

export function MapIcon({ className = 'h-5 w-5' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M9 4.5L4 6.5v13l5-2 6 2 5-2v-13l-5 2-6-2z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M9 4.5v13M15 6.5v13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

export function WalletIcon({ className = 'h-5 w-5' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M3 7.5a2 2 0 012-2h13a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2v-9z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M3 9h15.5a1.5 1.5 0 011.5 1.5v3a1.5 1.5 0 01-1.5 1.5H16a2 2 0 010-4h4" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx="16" cy="12" r="0.9" fill="currentColor" />
    </svg>
  )
}

export function ReceiptIcon({ className = 'h-5 w-5' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M6 3h12v18l-2.5-1.5L13 21l-2.5-1.5L8 21l-2-1.5V3z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M9 8h6M9 12h6M9 16h3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

/** Phase T11: Data Review Queue nav icon — a flagged-alert triangle. */
export function FlagAlertIcon({ className = 'h-5 w-5' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M10.5 3.5a1.7 1.7 0 013 0l8.2 14.6a1.7 1.7 0 01-1.5 2.5H3.8a1.7 1.7 0 01-1.5-2.5L10.5 3.5z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M12 9.5v4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="12" cy="17" r="1" fill="currentColor" />
    </svg>
  )
}
