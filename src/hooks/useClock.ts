import { useEffect, useState } from 'react'

/**
 * Returns the current time, updating every second. Used for the live
 * date/time display on the attendance dashboard.
 */
export function useClock(): Date {
  const [now, setNow] = useState(new Date())

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(interval)
  }, [])

  return now
}

const dateFormatter = new Intl.DateTimeFormat('en-IN', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'Asia/Kolkata',
})

const timeFormatter = new Intl.DateTimeFormat('en-IN', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: true,
  timeZone: 'Asia/Kolkata',
})

export function formatDateIST(date: Date): string {
  return dateFormatter.format(date)
}

export function formatTimeIST(date: Date): string {
  return timeFormatter.format(date)
}
