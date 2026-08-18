import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { getAllEmployees } from '@/services/employeeService'
import { getClaimsByStatus } from '@/services/travelClaimService'
import type { ClaimStatus, Employee, TravelClaim } from '@/types'
import { formatDateIST } from '@/hooks/useClock'
import DashboardHeader from '@/components/DashboardHeader'
import AdminNavTabs from '@/components/AdminNavTabs'
import { TableRowSkeleton } from '@/components/Skeleton'

const CLAIM_STATUS_STYLES: Record<ClaimStatus, { label: string; bg: string; text: string }> = {
  draft: { label: 'Draft', bg: 'bg-slate-100', text: 'text-slate-600' },
  submitted: { label: 'Submitted', bg: 'bg-amber-100', text: 'text-amber-700' },
  approved: { label: 'Approved', bg: 'bg-emerald-100', text: 'text-emerald-700' },
  rejected: { label: 'Rejected', bg: 'bg-red-100', text: 'text-red-700' },
  sent_back: { label: 'Sent Back', bg: 'bg-orange-100', text: 'text-orange-700' },
}

function StatusBadge({ status }: { status: ClaimStatus }) {
  const s = CLAIM_STATUS_STYLES[status]
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${s.bg} ${s.text}`}>
      {s.label}
    </span>
  )
}

type FilterOption = ClaimStatus | 'all'

const filterOptions: { value: FilterOption; label: string }[] = [
  { value: 'submitted', label: 'Submitted' },
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'sent_back', label: 'Sent Back' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
]

// Every status the queue can show under "All" — since getClaimsByStatus
// takes a single status (a provable admin-only query, see travelClaimService.ts),
// "All" fetches each status in parallel and merges rather than trying to
// query across statuses in one call.
const ALL_STATUSES: ClaimStatus[] = ['draft', 'submitted', 'approved', 'rejected', 'sent_back']

export default function AdminClaimsQueuePage() {
  const [filter, setFilter] = useState<FilterOption>('submitted')
  const [employees, setEmployees] = useState<Employee[]>([])
  const [claims, setClaims] = useState<TravelClaim[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    const claimsPromise: Promise<TravelClaim[]> =
      filter === 'all'
        ? Promise.all(ALL_STATUSES.map((s) => getClaimsByStatus(s))).then((lists) => lists.flat())
        : getClaimsByStatus(filter)

    Promise.all([getAllEmployees(), claimsPromise])
      .then(([employeeList, claimList]) => {
        if (cancelled) return
        setEmployees(employeeList)
        setClaims(claimList.sort((a, b) => b.date.toMillis() - a.date.toMillis()))
      })
      .catch((err) => {
        console.error('[AdminClaimsQueuePage] Failed to load claims:', err)
        if (!cancelled) setError('Something went wrong loading travel claims.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [filter])

  const employeeById = useMemo(() => {
    const map = new Map<string, Employee>()
    employees.forEach((e) => map.set(e.id, e))
    return map
  }, [employees])

  const pendingCount = useMemo(
    () => claims.filter((c) => c.status === 'submitted').length,
    [claims]
  )

  return (
    <div className="min-h-screen bg-slate-50">
      <DashboardHeader />
      <AdminNavTabs />

      <main className="max-w-5xl mx-auto px-4 sm:px-6 pt-6 pb-24 sm:pb-6 space-y-6">
        <div>
          <h1 className="text-lg font-semibold text-slate-800">Travel Claims</h1>
          <p className="text-sm text-slate-400">
            {filter === 'submitted'
              ? `${pendingCount} claim${pendingCount === 1 ? '' : 's'} awaiting your decision`
              : 'Review and act on employee travel claims'}
          </p>
        </div>

        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-600">
            {error}
          </div>
        )}

        <div className="rounded-2xl bg-white shadow-sm border border-slate-200 p-6">
          <div className="flex flex-wrap gap-2">
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

            {!loading && !error && claims.length === 0 && (
              <p className="text-sm text-slate-400 text-center py-8">
                No {filter === 'all' ? '' : CLAIM_STATUS_STYLES[filter as ClaimStatus]?.label.toLowerCase() + ' '}
                travel claims right now.
              </p>
            )}

            {!loading && !error && claims.length > 0 && (
              <>
                {/* Desktop table */}
                <table className="hidden sm:table w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-slate-400 border-b border-slate-200">
                      <th className="pb-2 font-medium">Employee</th>
                      <th className="pb-2 font-medium">Date</th>
                      <th className="pb-2 font-medium">Eligible Distance</th>
                      <th className="pb-2 font-medium">Total Claim</th>
                      <th className="pb-2 font-medium">Status</th>
                      <th className="pb-2 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {claims.map((claim) => {
                      const emp = employeeById.get(claim.employeeId)
                      return (
                        <tr key={claim.id} className="border-b border-slate-100 last:border-0">
                          <td className="py-2.5">
                            <p className="text-slate-800 font-medium">{emp?.name ?? 'Unknown'}</p>
                            <p className="text-xs text-slate-400">{emp?.employeeId ?? claim.employeeId}</p>
                          </td>
                          <td className="py-2.5 text-slate-700">{formatDateIST(claim.date.toDate())}</td>
                          <td className="py-2.5 text-slate-700">{claim.eligibleDistanceKm.toFixed(2)} km</td>
                          <td className="py-2.5 text-slate-700">₹{claim.totalClaim.toFixed(2)}</td>
                          <td className="py-2.5">
                            <StatusBadge status={claim.status} />
                          </td>
                          <td className="py-2.5 text-right">
                            <Link
                              to={`/claim/${claim.employeeId}/${claim.attendanceLogId}`}
                              className="text-xs font-medium text-brand-700 hover:underline"
                            >
                              Review
                            </Link>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>

                {/* Mobile cards */}
                <div className="sm:hidden space-y-3">
                  {claims.map((claim) => {
                    const emp = employeeById.get(claim.employeeId)
                    return (
                      <div key={claim.id} className="rounded-lg border border-slate-200 p-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-medium text-slate-800">{emp?.name ?? 'Unknown'}</p>
                            <p className="text-xs text-slate-400">{emp?.employeeId ?? claim.employeeId}</p>
                          </div>
                          <StatusBadge status={claim.status} />
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-500">
                          <span>Date: {formatDateIST(claim.date.toDate())}</span>
                          <span>{claim.eligibleDistanceKm.toFixed(2)} km</span>
                          <span>Total: ₹{claim.totalClaim.toFixed(2)}</span>
                        </div>
                        <div className="mt-2 flex justify-end">
                          <Link
                            to={`/claim/${claim.employeeId}/${claim.attendanceLogId}`}
                            className="text-xs font-medium text-brand-700 hover:underline"
                          >
                            Review
                          </Link>
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
