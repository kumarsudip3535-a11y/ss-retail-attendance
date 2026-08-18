/** Formats a decimal hours value for display, e.g. 8.5 -> "8.50 hrs" */
export function formatHours(hours: number): string {
  return `${hours.toFixed(2)} hrs`
}

/** Live elapsed hours between a login time and now, as a decimal. */
export function computeElapsedHours(loginDate: Date, now: Date): number {
  const ms = now.getTime() - loginDate.getTime()
  return Math.max(ms / 3600000, 0)
}
