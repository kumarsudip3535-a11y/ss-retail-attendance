import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { getAllEmployees } from '@/services/employeeService'
import { getSessionsForDateRange, getSessionsForEmployeeDateRange } from '@/services/trackingService'
import { getClaimForSession } from '@/services/travelClaimService'
import type { ClaimStatus, Employee, TrackingSession, TravelClaim } from '@/types'
import { getDayRange, getMonthRange, getCustomRange, type DateRange } from '@/utils/dateRanges'
import { formatDateIST, formatTimeIST } from '@/hooks/useClock'
import { generateCSV, downloadCSV } from '@/utils/csvExport'
import DashboardHeader from '@/components/DashboardHeader'
import AdminNavTabs from '@/components/AdminNavTabs'
import { TableRowSkeleton } from '@/components/Skeleton'

type ReportType = 'daily' | 'monthly' | 'employee'

const CLAIM_STATUS_LABELS: Record<ClaimStatus, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  approved: 'Approved',
  rejected: 'Rejected',
  sent_back: 'Sent Back',
}

function toDateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function toMonthInputValue(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

interface SessionRow {
  session: TrackingSession
  claim: TravelClaim | null
}

/** Attaches each session's claim (if any exists yet) — direct get()-by-ID per session, same pattern travelClaimService.ts already establishes as safe for a nonexistent doc. */
async function attachClaims(sessions: TrackingSession[]): Promise<SessionRow[]> {
  const claims = await Promise.all(sessions.map((s) => getClaimForSession(s.id)))
  return sessions.map((session, i) => ({ session, claim: claims[i] }))
}

function SessionTable({
  rows,
  employeeById,
  showEmployeeColumn,
}: {
  rows: SessionRow[]
  employeeById: Map<string, Employee>
  showEmployeeColumn: boolean
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-slate-400 text-center py-8">No tracked shifts in this range.</p>
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-slate-400 border-b border-slate-200">
          {showEmployeeColumn && <th className="pb-2 font-medium">Employee</th>}
          <th className="pb-2 font-medium">Date</th>
          <th className="pb-2 font-medium">GPS Distance</th>
          <th className="pb-2 font-medium">Eligible Distance</th>
          <th className="pb-2 font-medium">Claim Status</th>
          <th className="pb-2 font-medium">Claim Total</th>
          <th className="pb-2 font-medium"></th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ session, claim }) => {
          const emp = employeeById.get(session.employeeId)
          return (
            <tr key={session.id} className="border-b border-slate-100 last:border-0">
              {showEmployeeColumn && (
                <td className="py-2.5">
                  <p className="text-slate-800 font-medium">{emp?.name ?? 'Unknown'}</p>
                  <p className="text-xs text-slate-400">{emp?.employeeId ?? session.employeeId}</p>
                </td>
              )}
              <td className="py-2.5 text-slate-700">
                {formatDateIST(session.startTime.toDate())}
                <span className="text-xs text-slate-400 ml-1">{formatTimeIST(session.startTime.toDate())}</span>
              </td>
              <td className="py-2.5 text-slate-700">
                {session.totalDistanceKm !== null ? `${session.totalDistanceKm.toFixed(2)} km` : '—'}
              </td>
              <td className="py-2.5 text-slate-700">
                {claim ? `${claim.eligibleDistanceKm.toFixed(2)} km` : '—'}
              </td>
              <td className="py-2.5 text-slate-700">{claim ? CLAIM_STATUS_LABELS[claim.status] : '—'}</td>
              <td className="py-2.5 text-slate-700">{claim ? `₹${claim.totalClaim.toFixed(2)}` : '—'}</td>
              <td className="py-2.5 text-right space-x-3 whitespace-nowrap">
                {session.status === 'completed' && (
                  <>
                    <Link
                      to={`/replay/${session.employeeId}/${session.attendanceLogId}`}
                      className="text-xs font-medium text-brand-700 hover:underline"
                    >
                      Replay
                    </Link>
                    <Link
                      to={`/claim/${session.employeeId}/${session.attendanceLogId}`}
                      className="text-xs font-medium text-brand-700 hover:underline"
                    >
                      Claim
                    </Link>
                  </>
                )}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

interface MonthlySummaryRow {
  employee: Employee
  sessionCount: number
  totalGpsKm: number
  totalEligibleKm: number
  approvedAmount: number
  pendingAmount: number
  unclaimedCount: number
}

function summarizeByEmployee(rows: SessionRow[], employees: Employee[]): MonthlySummaryRow[] {
  const byEmployee = new Map<string, SessionRow[]>()
  rows.forEach((row) => {
    const list = byEmployee.get(row.session.employeeId) ?? []
    list.push(row)
    byEmployee.set(row.session.employeeId, list)
  })

  return employees
    .filter((emp) => byEmployee.has(emp.id))
    .map((employee) => {
      const employeeRows = byEmployee.get(employee.id) ?? []
      return {
        employee,
        sessionCount: employeeRows.length,
        totalGpsKm: employeeRows.reduce((sum, r) => sum + (r.session.totalDistanceKm ?? 0), 0),
        totalEligibleKm: employeeRows.reduce((sum, r) => sum + (r.claim?.eligibleDistanceKm ?? 0), 0),
        approvedAmount: employeeRows
          .filter((r) => r.claim?.status === 'approved')
          .reduce((sum, r) => sum + (r.claim?.totalClaim ?? 0), 0),
        pendingAmount: employeeRows
          .filter((r) => r.claim?.status === 'submitted')
          .reduce((sum, r) => sum + (r.claim?.totalClaim ?? 0), 0),
        unclaimedCount: employeeRows.filter((r) => r.session.status === 'completed' && !r.claim).length,
      }
    })
}

export default function TravelReportsPage() {
  const [reportType, setReportType] = useState<ReportType>('daily')

  const [dailyDate, setDailyDate] = useState(toDateInputValue(new Date()))
  const [monthlyMonth, setMonthlyMonth] = useState(toMonthInputValue(new Date()))
  const [employeeId, setEmployeeId] = useState('')
  const [empFrom, setEmpFrom] = useState(toDateInputValue(new Date()))
  const [empTo, setEmpTo] = useState(toDateInputValue(new Date()))

  const [employees, setEmployees] = useState<Employee[]>([])
  const [rows, setRows] = useState<SessionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getAllEmployees()
      .then((list) => {
        setEmployees(list)
        if (list.length > 0) setEmployeeId((prev) => prev || list[0].id)
      })
      .catch((err) => console.error('[TravelReportsPage] Failed to load employees:', err))
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
      case 'monthly': {
        const [year, month] = monthlyMonth.split('-').map(Number)
        return getMonthRange(new Date(year, month - 1, 1))
      }
      case 'employee':
        return getCustomRange(new Date(empFrom), new Date(empTo))
    }
  }, [reportType, dailyDate, monthlyMonth, empFrom, empTo])

  useEffect(() => {
    if (reportType === 'employee' && !employeeId) return

    let cancelled = false
    setLoading(true)
    setError(null)

    const fetchSessions =
      reportType === 'employee'
        ? getSessionsForEmployeeDateRange(employeeId, activeRange.from, activeRange.to)
        : getSessionsForDateRange(activeRange.from, activeRange.to)

    fetchSessions
      .then(attachClaims)
      .then((result) => {
        if (!cancelled) setRows(result)
      })
      .catch((err) => {
        console.error('[TravelReportsPage] Failed to load report data:', err)
        if (!cancelled) setError('Something went wrong loading this report.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [reportType, employeeId, activeRange])

  const monthlySummary = useMemo(
    () => (reportType === 'monthly' ? summarizeByEmployee(rows, employees) : []),
    [reportType, rows, employees]
  )

  function handleExport() {
    if (reportType === 'monthly') {
      if (monthlySummary.length === 0) {
        toast.error('No records to export for this report.')
        return
      }
      const csv = generateCSV(
        ['Employee ID', 'Employee Name', 'Shifts', 'Total GPS KM', 'Total Eligible KM', 'Approved (₹)', 'Pending (₹)', 'Unclaimed Shifts'],
        monthlySummary.map((r) => [
          r.employee.employeeId,
          r.employee.name,
          String(r.sessionCount),
          r.totalGpsKm.toFixed(2),
          r.totalEligibleKm.toFixed(2),
          r.approvedAmount.toFixed(2),
          r.pendingAmount.toFixed(2),
          String(r.unclaimedCount),
        ])
      )
      downloadCSV(`travel-monthly-${monthlyMonth}.csv`, csv)
      toast.success('CSV downloaded.')
      return
    }

    if (rows.length === 0) {
      toast.error('No records to export for this report.')
      return
    }
    const csv = generateCSV(
      ['Employee ID', 'Employee Name', 'Date', 'GPS Distance (km)', 'Eligible Distance (km)', 'Claim Status', 'Claim Total (₹)'],
      rows.map(({ session, claim }) => {
        const emp = employeeById.get(session.employeeId)
        return [
          emp?.employeeId ?? session.employeeId,
          emp?.name ?? 'Unknown',
          formatDateIST(session.startTime.toDate()),
          session.totalDistanceKm !== null ? session.totalDistanceKm.toFixed(2) : '',
          claim ? claim.eligibleDistanceKm.toFixed(2) : '',
          claim ? CLAIM_STATUS_LABELS[claim.status] : '',
          claim ? claim.totalClaim.toFixed(2) : '',
        ]
      })
    )
    downloadCSV(`travel-${reportType}-${toDateInputValue(new Date())}.csv`, csv)
    toast.success('CSV downloaded.')
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <DashboardHeader />
      <AdminNavTabs />

      <main className="max-w-5xl mx-auto px-4 sm:px-6 pt-6 pb-24 sm:pb-6">
        <div className="rounded-2xl bg-white shadow-sm border border-slate-200 p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-lg font-semibold text-slate-800">Travel Reports</h1>
              <p className="text-sm text-slate-400">GPS distance, eligible KM, and claim status — separate from the attendance Reports page.</p>
            </div>
            <button
              onClick={handleExport}
              className="rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2"
            >
              Export CSV
            </button>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {(['daily', 'monthly', 'employee'] as ReportType[]).map((type) => (
              <button
                key={type}
                onClick={() => setReportType(type)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors ${
                  reportType === type ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {type === 'employee' ? 'By Employee' : type}
              </button>
            ))}
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

            {!loading && error && <p className="text-sm text-red-600 text-center py-8">{error}</p>}

            {!loading && !error && reportType !== 'monthly' && (
              <SessionTable rows={rows} employeeById={employeeById} showEmployeeColumn={reportType === 'daily'} />
            )}

            {!loading && !error && reportType === 'monthly' && (
              <>
                {monthlySummary.length === 0 && (
                  <p className="text-sm text-slate-400 text-center py-8">No tracked shifts this month.</p>
                )}
                {monthlySummary.length > 0 && (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-slate-400 border-b border-slate-200">
                        <th className="pb-2 font-medium">Employee</th>
                        <th className="pb-2 font-medium">Shifts</th>
                        <th className="pb-2 font-medium">Total GPS KM</th>
                        <th className="pb-2 font-medium">Total Eligible KM</th>
                        <th className="pb-2 font-medium">Approved</th>
                        <th className="pb-2 font-medium">Pending</th>
                        <th className="pb-2 font-medium">Unclaimed</th>
                        <th className="pb-2 font-medium"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {monthlySummary.map((r) => (
                        <tr key={r.employee.id} className="border-b border-slate-100 last:border-0">
                          <td className="py-2.5">
                            <p className="text-slate-800 font-medium">{r.employee.name}</p>
                            <p className="text-xs text-slate-400">{r.employee.employeeId}</p>
                          </td>
                          <td className="py-2.5 text-slate-700">{r.sessionCount}</td>
                          <td className="py-2.5 text-slate-700">{r.totalGpsKm.toFixed(2)} km</td>
                          <td className="py-2.5 text-slate-700">{r.totalEligibleKm.toFixed(2)} km</td>
                          <td className="py-2.5 text-emerald-700 font-medium">₹{r.approvedAmount.toFixed(2)}</td>
                          <td className="py-2.5 text-amber-700">₹{r.pendingAmount.toFixed(2)}</td>
                          <td className="py-2.5 text-slate-500">{r.unclaimedCount > 0 ? r.unclaimedCount : '—'}</td>
                          <td className="py-2.5 text-right">
                            <Link to="/admin/claims" className="text-xs font-medium text-brand-700 hover:underline">
                              Claims →
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
