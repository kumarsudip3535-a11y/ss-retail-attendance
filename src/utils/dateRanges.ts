export type DateRangeFilter = 'today' | 'week' | 'month' | 'custom'

export interface DateRange {
  from: Date
  to: Date
}

/** Midnight to 23:59:59.999 for the given date (defaults to today). */
export function getDayRange(referenceDate: Date = new Date()): DateRange {
  const from = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate(),
    0, 0, 0, 0
  )
  const to = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate(),
    23, 59, 59, 999
  )
  return { from, to }
}

/** Midnight to 23:59:59.999 today, in the browser's local time. */
export function getTodayRange(): DateRange {
  return getDayRange(new Date())
}

/** Monday through Sunday of the week containing the given date. */
export function getWeekRange(referenceDate: Date = new Date()): DateRange {
  const day = referenceDate.getDay() // 0 = Sunday, 1 = Monday, ... 6 = Saturday
  const diffToMonday = day === 0 ? 6 : day - 1

  const monday = new Date(referenceDate)
  monday.setDate(referenceDate.getDate() - diffToMonday)
  monday.setHours(0, 0, 0, 0)

  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  sunday.setHours(23, 59, 59, 999)

  return { from: monday, to: sunday }
}

/** Monday through Sunday of the current week. */
export function getThisWeekRange(): DateRange {
  return getWeekRange(new Date())
}

/** First through last day of the calendar month containing the given date. */
export function getMonthRange(referenceDate: Date = new Date()): DateRange {
  const from = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    1, 0, 0, 0, 0
  )
  const to = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth() + 1,
    0, 23, 59, 59, 999
  )
  return { from, to }
}

/** First through last day of the current calendar month. */
export function getThisMonthRange(): DateRange {
  return getMonthRange(new Date())
}

/** Wraps a custom from/to pair, normalizing to start/end of those days. */
export function getCustomRange(fromDate: Date, toDate: Date): DateRange {
  const from = new Date(fromDate)
  from.setHours(0, 0, 0, 0)
  const to = new Date(toDate)
  to.setHours(23, 59, 59, 999)
  return { from, to }
}

export function resolveDateRange(
  filter: DateRangeFilter,
  custom?: { from: Date; to: Date }
): DateRange {
  switch (filter) {
    case 'today':
      return getTodayRange()
    case 'week':
      return getThisWeekRange()
    case 'month':
      return getThisMonthRange()
    case 'custom':
      if (!custom) return getTodayRange()
      return getCustomRange(custom.from, custom.to)
  }
}
