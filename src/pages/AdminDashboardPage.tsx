import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { getAllEmployees } from '@/services/employeeService'
import {
  getAttendanceLogsForDateRange,
} from '@/services/attendanceService'
import { getAttendanceStatus } from '@/types'
import type { AttendanceLog, Employee } from '@/types'
import { getTodayRange, getCustomRange } from '@/utils/dateRanges'
import { formatHours } from '@/utils/hours'
import { formatDateIST, formatTimeIST } from '@/hooks/useClock'
import DashboardHeader from '@/components/DashboardHeader'
import AdminNavTabs from '@/components/AdminNavTabs'
import { SummaryCardSkeleton, TableRowSkeleton } from '@/components/Skeleton'

type StatusFilter = 'all' | 'active' | 'completed'

function toDateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function SummaryCard({
  label,
  value,
  accent,
}: {
  label: string
  value: string | number
  accent?: 'emerald' | 'red' | 'amber'
}) {
  const valueColor =
    accent === 'emerald'
      ? 'text-emerald-600'
      : accent === 'red'
        ? 'text-red-600'
        : accent === 'amber'
          ? 'text-amber-600'
          : 'text-slate-800'

  return (
    <div className="rounded-xl bg-white border border-slate-200 p-4">
      <p className="text-xs text-slate-400">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${valueColor}`}>{value}</p>
    </div>
  )
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

export default function AdminDashboardPage() {
  const { employee } = useAuth()

  const [employees, setEmployees] = useState<Employee[]>([])
  const [todayLogs, setTodayLogs] = useState<AttendanceLog[]>([])
  const [tableLogs, setTableLogs] = useState<AttendanceLog[]>([])
  const [loadingSummary, setLoadingSummary] = useState(true)
  const [loadingTable, setLoadingTable] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [tableDate, setTableDate] = useState(toDateInputValue(new Date()))

  // Load employees + today's summary stats once on mount.
  useEffect(() => {
    let cancelled = false
    setLoadingSummary(true)

    const todayRange = getTodayRange()

    Promise.all([
      getAllEmployees(),
      getAttendanceLogsForDateRange(todayRange.from, todayRange.to),
    ])
      .then(([employeeList, logs]) => {
        if (cancelled) return
        setEmployees(employeeList)
        setTodayLogs(logs)
      })
      .catch((err) => {
        console.error('[AdminDashboardPage] Failed to load summary data:', err)
        if (!cancelled) setError('Something went wrong loading dashboard data.')
      })
      .finally(() => {
        if (!cancelled) setLoadingSummary(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  // Load the table's attendance logs whenever the selected date changes.
  useEffect(() => {
    let cancelled = false
    setLoadingTable(true)

    const range = getCustomRange(new Date(tableDate), new Date(tableDate))

    getAttendanceLogsForDateRange(range.from, range.to)
      .then((logs) => {
        if (!cancelled) setTableLogs(logs)
      })
      .catch((err) => {
        console.error('[AdminDashboardPage] Failed to load table data:', err)
        if (!cancelled) setError('Something went wrong loading attendance records.')
      })
      .finally(() => {
        if (!cancelled) setLoadingTable(false)
      })

    return () => {
      cancelled = true
    }
  }, [tableDate])

  const employeeById = useMemo(() => {
    const map = new Map<string, Employee>()
    employees.forEach((e) => map.set(e.id, e))
    return map
  }, [employees])

  const activeEmployees = useMemo(
    () => employees.filter((e) => !e.disabled),
    [employees]
  )

  const presentTodayCount = useMemo(
    () => new Set(todayLogs.map((l) => l.employeeId)).size,
    [todayLogs]
  )

  const currentlyWorkingCount = useMemo(
    () => todayLogs.filter((l) => !l.logoutTime).length,
    [todayLogs]
  )

  const totalOvertimeToday = useMemo(
    () =>
      todayLogs.reduce((sum, l) => sum + (l.overtimeHours ?? 0), 0),
    [todayLogs]
  )

  const filteredTableLogs = useMemo(() => {
    return tableLogs.filter((log) => {
      const status = getAttendanceStatus(log)
      if (statusFilter !== 'all' && status !== statusFilter) return false

      if (searchQuery.trim()) {
        const emp = employeeById.get(log.employeeId)
        const haystack = `${emp?.name ?? ''} ${emp?.employeeId ?? ''}`.toLowerCase()
        if (!haystack.includes(searchQuery.trim().toLowerCase())) return false
      }

      return true
    })
  }, [tableLogs, statusFilter, searchQuery, employeeById])

  return (
    <div className="min-h-screen bg-slate-50">
      <DashboardHeader />
      <AdminNavTabs />

      <main className="max-w-5xl mx-auto px-4 sm:px-6 pt-6 pb-24 sm:pb-6 space-y-6">
        <div>
          <h1 className="text-lg font-semibold text-slate-800">
            Welcome, {employee?.name}
          </h1>
          <p className="text-sm text-slate-400">Admin overview for today</p>
        </div>

        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-600">
            {error}
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {loadingSummary ? (
            <>
              <SummaryCardSkeleton />
              <SummaryCardSkeleton />
              <SummaryCardSkeleton />
              <SummaryCardSkeleton />
              <SummaryCardSkeleton />
            </>
          ) : (
            <>
              <SummaryCard label="Total Employees" value={activeEmployees.length} />
              <SummaryCard
                label="Present Today"
                value={presentTodayCount}
                accent="emerald"
              />
              <SummaryCard
                label="Absent Today"
                value={Math.max(activeEmployees.length - presentTodayCount, 0)}
                accent="red"
              />
              <SummaryCard
                label="Currently Working"
                value={currentlyWorkingCount}
                accent="emerald"
              />
              <SummaryCard
                label="Total Overtime"
                value={formatHours(totalOvertimeToday)}
                accent="amber"
              />
            </>
          )}
        </div>

        <div className="rounded-2xl bg-white shadow-sm border border-slate-200 p-6">
          <div className="flex flex-wrap items-center gap-3 justify-between">
            <h2 className="text-base font-semibold text-slate-800">
              Attendance Records
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                placeholder="Search employee…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm w-40"
              />
              <input
                type="date"
                value={tableDate}
                onChange={(e) => setTableDate(e.target.value)}
                className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              />
              <select
                value={statusFilter}
                onChange={(e) =>
                  setStatusFilter(e.target.value as StatusFilter)
                }
                className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              >
                <option value="all">All Status</option>
                <option value="active">Active</option>
                <option value="completed">Completed</option>
              </select>
            </div>
          </div>

          <div className="mt-4">
            {loadingTable && (
              <table className="w-full text-sm">
                <tbody>
                  <TableRowSkeleton columns={7} />
                  <TableRowSkeleton columns={7} />
                  <TableRowSkeleton columns={7} />
                </tbody>
              </table>
            )}

            {!loadingTable && filteredTableLogs.length === 0 && (
              <div className="text-center py-10">
                <svg
                  className="mx-auto h-10 w-10 text-slate-300"
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <rect
                    x="4"
                    y="5"
                    width="16"
                    height="15"
                    rx="2"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  />
                  <path
                    d="M4 9h16M8 3v3M16 3v3"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
                <p className="mt-2 text-sm text-slate-400">
                  No attendance records match your filters.
                </p>
              </div>
            )}

            {!loadingTable && filteredTableLogs.length > 0 && (
              <>
                {/* Desktop table */}
                <table className="hidden sm:table w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-slate-400 border-b border-slate-200">
                      <th className="pb-2 font-medium">Employee</th>
                      <th className="pb-2 font-medium">Date</th>
                      <th className="pb-2 font-medium">Punch In</th>
                      <th className="pb-2 font-medium">Punch Out</th>
                      <th className="pb-2 font-medium">Hours</th>
                      <th className="pb-2 font-medium">Overtime</th>
                      <th className="pb-2 font-medium">Status</th>
                      <th className="pb-2 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTableLogs.map((log) => {
                      const emp = employeeById.get(log.employeeId)
                      return (
                        <tr
                          key={log.id}
                          className="border-b border-slate-100 last:border-0"
                        >
                          <td className="py-2.5">
                            <p className="text-slate-800 font-medium">
                              {emp?.name ?? 'Unknown'}
                            </p>
                            <p className="text-xs text-slate-400">
                              {emp?.employeeId ?? log.employeeId}
                            </p>
                          </td>
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
                      )
                    })}
                  </tbody>
                </table>

                {/* Mobile cards */}
                <div className="sm:hidden space-y-3">
                  {filteredTableLogs.map((log) => {
                    const emp = employeeById.get(log.employeeId)
                    return (
                      <div
                        key={log.id}
                        className="rounded-lg border border-slate-200 p-3"
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-medium text-slate-800">
                              {emp?.name ?? 'Unknown'}
                            </p>
                            <p className="text-xs text-slate-400">
                              {emp?.employeeId ?? log.employeeId}
                            </p>
                          </div>
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
                    )
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
