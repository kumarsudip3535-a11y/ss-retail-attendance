import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { getAllEmployees } from '@/services/employeeService'
import {
  getAttendanceHistory,
  getAttendanceLogsForDateRange,
} from '@/services/attendanceService'
import { getAttendanceStatus } from '@/types'
import type { AttendanceLog, Employee } from '@/types'
import {
  getDayRange,
  getWeekRange,
  getMonthRange,
  getCustomRange,
  type DateRange,
} from '@/utils/dateRanges'
import { formatHours } from '@/utils/hours'
import { formatDateIST, formatTimeIST } from '@/hooks/useClock'
import { generateAttendanceCSV, downloadCSV } from '@/utils/csvExport'
import DashboardHeader from '@/components/DashboardHeader'
import AdminNavTabs from '@/components/AdminNavTabs'
import { TableRowSkeleton } from '@/components/Skeleton'

type ReportType = 'daily' | 'weekly' | 'monthly' | 'employee'

function toDateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function toMonthInputValue(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
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

export default function ReportsPage() {
  const [reportType, setReportType] = useState<ReportType>('daily')

  const [dailyDate, setDailyDate] = useState(toDateInputValue(new Date()))
  const [weeklyDate, setWeeklyDate] = useState(toDateInputValue(new Date()))
  const [monthlyMonth, setMonthlyMonth] = useState(
    toMonthInputValue(new Date())
  )
  const [employeeId, setEmployeeId] = useState('')
  const [empFrom, setEmpFrom] = useState(toDateInputValue(new Date()))
  const [empTo, setEmpTo] = useState(toDateInputValue(new Date()))

  const [employees, setEmployees] = useState<Employee[]>([])
  const [logs, setLogs] = useState<AttendanceLog[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getAllEmployees()
      .then((list) => {
        setEmployees(list)
        if (list.length > 0) setEmployeeId((prev) => prev || list[0].id)
      })
      .catch((err) => {
        console.error('[ReportsPage] Failed to load employees:', err)
      })
  }, [])

  const employeeById = useMemo(() => {
    const map = new Map<string, Employee>()
    employees.forEach((e) => map.set(e.id, e))
    return map
  }, [employees])

  const activeRange: DateRange = useMemo(() => {
    switch (reportType) {
      case 'daily':
        return getDayRange(new Date(dailyDate))
      case 'weekly':
        return getWeekRange(new Date(weeklyDate))
      case 'monthly': {
        const [year, month] = monthlyMonth.split('-').map(Number)
        return getMonthRange(new Date(year, month - 1, 1))
      }
      case 'employee':
        return getCustomRange(new Date(empFrom), new Date(empTo))
    }
  }, [reportType, dailyDate, weeklyDate, monthlyMonth, empFrom, empTo])

  useEffect(() => {
    if (reportType === 'employee' && !employeeId) return

    let cancelled = false
    setLoading(true)
    setError(null)

    const fetchLogs =
      reportType === 'employee'
        ? getAttendanceHistory(employeeId, {
            from: activeRange.from,
            to: activeRange.to,
          })
        : getAttendanceLogsForDateRange(activeRange.from, activeRange.to)

    fetchLogs
      .then((result) => {
        if (!cancelled) setLogs(result)
      })
      .catch((err) => {
        console.error('[ReportsPage] Failed to load report data:', err)
        if (!cancelled) setError('Something went wrong loading this report.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [reportType, employeeId, activeRange])

  function handleExport() {
    if (logs.length === 0) {
      toast.error('No records to export for this report.')
      return
    }
    const csv = generateAttendanceCSV(logs, employeeById)
    const filename = `attendance-${reportType}-${toDateInputValue(new Date())}.csv`
    downloadCSV(filename, csv)
    toast.success('CSV downloaded.')
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <DashboardHeader />
      <AdminNavTabs />

      <main className="max-w-5xl mx-auto px-4 sm:px-6 pt-6 pb-24 sm:pb-6">
        <div className="rounded-2xl bg-white shadow-sm border border-slate-200 p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-lg font-semibold text-slate-800">Reports</h1>
            <button
              onClick={handleExport}
              className="rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2"
            >
              Export CSV
            </button>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {(['daily', 'weekly', 'monthly', 'employee'] as ReportType[]).map(
              (type) => (
                <button
                  key={type}
                  onClick={() => setReportType(type)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors ${
                    reportType === type
                      ? 'bg-brand-600 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {type}
                </button>
              )
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            {reportType === 'daily' && (
              <label className="text-xs text-slate-500 flex items-center gap-2">
                Date
                <input
                  type="date"
                  value={dailyDate}
                  onChange={(e) => setDailyDate(e.target.value)}
                  className="rounded-lg border border-slate-300 px-2 py-1 text-sm"
                />
              </label>
            )}

            {reportType === 'weekly' && (
              <label className="text-xs text-slate-500 flex items-center gap-2">
                Any day in week
                <input
                  type="date"
                  value={weeklyDate}
                  onChange={(e) => setWeeklyDate(e.target.value)}
                  className="rounded-lg border border-slate-300 px-2 py-1 text-sm"
                />
                <span className="text-slate-400">
                  ({formatDateIST(activeRange.from)} –{' '}
                  {formatDateIST(activeRange.to)})
                </span>
              </label>
            )}

            {reportType === 'monthly' && (
              <label className="text-xs text-slate-500 flex items-center gap-2">
                Month
                <input
                  type="month"
                  value={monthlyMonth}
                  onChange={(e) => setMonthlyMonth(e.target.value)}
                  className="rounded-lg border border-slate-300 px-2 py-1 text-sm"
                />
              </label>
            )}

            {reportType === 'employee' && (
              <>
                <label className="text-xs text-slate-500 flex items-center gap-2">
                  Employee
                  <select
                    value={employeeId}
                    onChange={(e) => setEmployeeId(e.target.value)}
                    className="rounded-lg border border-slate-300 px-2 py-1 text-sm"
                  >
                    {employees.map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        {emp.name} ({emp.employeeId})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-slate-500 flex items-center gap-2">
                  From
                  <input
                    type="date"
                    value={empFrom}
                    onChange={(e) => setEmpFrom(e.target.value)}
                    className="rounded-lg border border-slate-300 px-2 py-1 text-sm"
                  />
                </label>
                <label className="text-xs text-slate-500 flex items-center gap-2">
                  To
                  <input
                    type="date"
                    value={empTo}
                    onChange={(e) => setEmpTo(e.target.value)}
                    className="rounded-lg border border-slate-300 px-2 py-1 text-sm"
                  />
                </label>
              </>
            )}
          </div>

          <div className="mt-6">
            {loading && (
              <table className="w-full text-sm">
                <tbody>
                  <TableRowSkeleton columns={7} />
                  <TableRowSkeleton columns={7} />
                  <TableRowSkeleton columns={7} />
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
                No attendance records for this report.
              </p>
            )}

            {!loading && !error && logs.length > 0 && (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-400 border-b border-slate-200">
                    <th className="pb-2 font-medium">Employee</th>
                    <th className="pb-2 font-medium">Date</th>
                    <th className="pb-2 font-medium">Punch In</th>
                    <th className="pb-2 font-medium">Punch Out</th>
                    <th className="pb-2 font-medium">Hours</th>
                    <th className="pb-2 font-medium">Overtime</th>
                    <th className="pb-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => {
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
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
