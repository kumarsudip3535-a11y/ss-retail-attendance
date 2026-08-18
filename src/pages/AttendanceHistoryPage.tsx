import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { getAttendanceHistory } from '@/services/attendanceService'
import { getAttendanceStatus } from '@/types'
import type { AttendanceLog } from '@/types'
import { resolveDateRange, type DateRangeFilter } from '@/utils/dateRanges'
import { formatHours } from '@/utils/hours'
import { formatDateIST, formatTimeIST } from '@/hooks/useClock'
import DashboardHeader from '@/components/DashboardHeader'
import EmployeeNavTabs from '@/components/EmployeeNavTabs'
import { TableRowSkeleton } from '@/components/Skeleton'

const filterOptions: { value: DateRangeFilter; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This Week' },
  { value: 'month', label: 'This Month' },
  { value: 'custom', label: 'Custom' },
]

function toDateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function StatusBadge({ log }: { log: AttendanceLog }) {
  const status = getAttendanceStatus(log)
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
        status === 'active'
          ? 'bg-emerald-100 text-emerald-700'
          : 'bg-slate-100 text-slate-600'
      }`}
    >
      {status === 'active' ? 'Active' : 'Completed'}
    </span>
  )
}

/**
 * Only shown for completed shifts — Phase T5's Route Replay screen looks
 * up the tracking session by attendanceLogId itself, so this link doesn't
 * need to know whether tracking data actually exists; the replay page
 * handles the "no tracking data for this shift" case gracefully.
 */
function ReplayLink({ log }: { log: AttendanceLog }) {
  if (!log.logoutTime) return null
  return (
    <Link
      to={`/replay/${log.employeeId}/${log.id}`}
      className="text-xs font-medium text-brand-700 hover:underline"
    >
      Replay Route
    </Link>
  )
}

/**
 * Phase T9: same "just link, let the destination page sort out whether
 * there's anything there" pattern as ReplayLink above — TravelClaimPage
 * itself handles the "no tracking data for this shift" case.
 */
function ClaimLink({ log }: { log: AttendanceLog }) {
  if (!log.logoutTime) return null
  return (
    <Link
      to={`/claim/${log.employeeId}/${log.id}`}
      className="text-xs font-medium text-brand-700 hover:underline"
    >
      Travel Claim
    </Link>
  )
}

export default function AttendanceHistoryPage() {
  const { employee } = useAuth()
  const [filter, setFilter] = useState<DateRangeFilter>('today')
  const [customFrom, setCustomFrom] = useState(toDateInputValue(new Date()))
  const [customTo, setCustomTo] = useState(toDateInputValue(new Date()))
  const [logs, setLogs] = useState<AttendanceLog[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!employee) return

    let cancelled = false
    setLoading(true)
    setError(null)

    const range = resolveDateRange(
      filter,
      filter === 'custom'
        ? { from: new Date(customFrom), to: new Date(customTo) }
        : undefined
    )

    getAttendanceHistory(employee.id, { from: range.from, to: range.to })
      .then((result) => {
        if (!cancelled) setLogs(result)
      })
      .catch((err) => {
        console.error('[AttendanceHistoryPage] Failed to load history:', err)
        if (!cancelled) {
          setError('Something went wrong loading your attendance history.')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [employee, filter, customFrom, customTo])

  return (
    <div className="min-h-screen bg-slate-50">
      <DashboardHeader />
      <EmployeeNavTabs />

      <main className="max-w-3xl mx-auto px-4 sm:px-6 pt-6 pb-24 sm:pb-6">
        <div className="rounded-2xl bg-white shadow-sm border border-slate-200 p-6">
          <h1 className="text-lg font-semibold text-slate-800">
            Attendance History
          </h1>

          <div className="mt-4 flex flex-wrap gap-2">
            {filterOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setFilter(opt.value)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  filter === opt.value
                    ? 'bg-brand-600 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {filter === 'custom' && (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <label className="text-xs text-slate-500 flex items-center gap-2">
                From
                <input
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="rounded-lg border border-slate-300 px-2 py-1 text-sm"
                />
              </label>
              <label className="text-xs text-slate-500 flex items-center gap-2">
                To
                <input
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="rounded-lg border border-slate-300 px-2 py-1 text-sm"
                />
              </label>
            </div>
          )}

          <div className="mt-6">
            {loading && (
              <table className="w-full text-sm">
                <tbody>
                  <TableRowSkeleton columns={6} />
                  <TableRowSkeleton columns={6} />
                  <TableRowSkeleton columns={6} />
                </tbody>
              </table>
            )}

            {!loading && error && (
              <p className="text-sm text-red-600 text-center py-8">
                {error}
              </p>
            )}

            {!loading && !error && logs.length === 0 && (
              <p className="text-sm text-slate-400 text-center py-8">
                No attendance records for this period.
              </p>
            )}

            {!loading && !error && logs.length > 0 && (
              <>
                {/* Desktop table */}
                <table className="hidden sm:table w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-slate-400 border-b border-slate-200">
                      <th className="pb-2 font-medium">Date</th>
                      <th className="pb-2 font-medium">Punch In</th>
                      <th className="pb-2 font-medium">Punch Out</th>
                      <th className="pb-2 font-medium">Total Hours</th>
                      <th className="pb-2 font-medium">Overtime</th>
                      <th className="pb-2 font-medium">Status</th>
                      <th className="pb-2 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((log) => (
                      <tr
                        key={log.id}
                        className="border-b border-slate-100 last:border-0"
                      >
                        <td className="py-2.5 text-slate-700">
                          {formatDateIST(log.loginTime.toDate())}
                        </td>
                        <td className="py-2.5 text-slate-700">
                          {formatTimeIST(log.loginTime.toDate())}
                        </td>
                        <td className="py-2.5 text-slate-700">
                          {log.logoutTime
                            ? formatTimeIST(log.logoutTime.toDate())
                            : '—'}
                        </td>
                        <td className="py-2.5 text-slate-700">
                          {log.totalHours !== null
                            ? formatHours(log.totalHours)
                            : '—'}
                        </td>
                        <td className="py-2.5 text-slate-700">
                          {log.overtimeHours !== null
                            ? formatHours(log.overtimeHours)
                            : '—'}
                        </td>
                        <td className="py-2.5">
                          <StatusBadge log={log} />
                        </td>
                        <td className="py-2.5 text-right space-x-3">
                          <ReplayLink log={log} />
                          <ClaimLink log={log} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* Mobile cards */}
                <div className="sm:hidden space-y-3">
                  {logs.map((log) => (
                    <div
                      key={log.id}
                      className="rounded-lg border border-slate-200 p-3"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-slate-800">
                          {formatDateIST(log.loginTime.toDate())}
                        </span>
                        <StatusBadge log={log} />
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-500">
                        <span>
                          In: {formatTimeIST(log.loginTime.toDate())}
                        </span>
                        <span>
                          Out:{' '}
                          {log.logoutTime
                            ? formatTimeIST(log.logoutTime.toDate())
                            : '—'}
                        </span>
                        <span>
                          Hours:{' '}
                          {log.totalHours !== null
                            ? formatHours(log.totalHours)
                            : '—'}
                        </span>
                        <span>
                          Overtime:{' '}
                          {log.overtimeHours !== null
                            ? formatHours(log.overtimeHours)
                            : '—'}
                        </span>
                      </div>
                      <div className="mt-2 flex justify-end gap-3">
                        <ReplayLink log={log} />
                        <ClaimLink log={log} />
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
