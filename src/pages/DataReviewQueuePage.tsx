import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { getAllEmployees } from '@/services/employeeService'
import {
  getSegmentsByReviewStatus,
  getTrackingSessionById,
  updateSegmentReviewStatus,
} from '@/services/trackingService'
import type { Employee, RouteSegment, SegmentReviewStatus } from '@/types'
import { formatDateIST } from '@/hooks/useClock'
import DashboardHeader from '@/components/DashboardHeader'
import AdminNavTabs from '@/components/AdminNavTabs'
import ConfirmDialog from '@/components/ConfirmDialog'
import { TableRowSkeleton } from '@/components/Skeleton'

const QUALITY_FLAG_STYLES: Record<'low_accuracy' | 'needs_review', { label: string; bg: string; text: string }> = {
  low_accuracy: { label: 'Low Accuracy', bg: 'bg-amber-100', text: 'text-amber-700' },
  needs_review: { label: 'Needs Review', bg: 'bg-red-100', text: 'text-red-700' },
}

const REVIEW_STATUS_STYLES: Record<SegmentReviewStatus, { label: string; bg: string; text: string }> = {
  unreviewed: { label: 'Unreviewed', bg: 'bg-slate-100', text: 'text-slate-500' },
  verified: { label: 'Verified', bg: 'bg-emerald-100', text: 'text-emerald-700' },
  excluded: { label: 'Excluded', bg: 'bg-red-100', text: 'text-red-700' },
}

function QualityBadge({ flag }: { flag: 'low_accuracy' | 'needs_review' }) {
  const s = QUALITY_FLAG_STYLES[flag]
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${s.bg} ${s.text}`}>
      {s.label}
    </span>
  )
}

function ReviewStatusBadge({ status }: { status: SegmentReviewStatus }) {
  const s = REVIEW_STATUS_STYLES[status]
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${s.bg} ${s.text}`}>
      {s.label}
    </span>
  )
}

const filterOptions: { value: SegmentReviewStatus; label: string }[] = [
  { value: 'unreviewed', label: 'Unreviewed' },
  { value: 'verified', label: 'Verified' },
  { value: 'excluded', label: 'Excluded' },
]

/**
 * Phase T11: Data Accuracy Review Queue — every route segment across all
 * employees whose points came back low_accuracy or needs_review, so those
 * quality flags (previously computed and stored but shown nowhere) are
 * actually visible and actionable. See RouteReplayPage.tsx for the same
 * Verify/Exclude actions available inline on a single session's own page;
 * this page is the admin-facing "everything flagged, across everyone"
 * view for triaging without knowing which session to look at first.
 */
export default function DataReviewQueuePage() {
  const [filter, setFilter] = useState<SegmentReviewStatus>('unreviewed')
  const [employees, setEmployees] = useState<Employee[]>([])
  const [segments, setSegments] = useState<RouteSegment[]>([])
  const [attendanceLogIdBySession, setAttendanceLogIdBySession] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [excludeConfirm, setExcludeConfirm] = useState<RouteSegment | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    Promise.all([getAllEmployees(), getSegmentsByReviewStatus(filter)])
      .then(async ([employeeList, segList]) => {
        if (cancelled) return
        setEmployees(employeeList)
        setSegments(segList)

        // Resolve each distinct session once (multiple flagged segments
        // often share a session) to get the attendanceLogId the Route
        // Replay link needs — RouteSegment only carries trackingSessionId.
        const uniqueSessionIds = Array.from(new Set(segList.map((s) => s.trackingSessionId)))
        const sessions = await Promise.all(uniqueSessionIds.map((id) => getTrackingSessionById(id)))
        if (cancelled) return
        const map = new Map<string, string>()
        sessions.forEach((session, i) => {
          if (session) map.set(uniqueSessionIds[i], session.attendanceLogId)
        })
        setAttendanceLogIdBySession(map)
      })
      .catch((err) => {
        console.error('[DataReviewQueuePage] Failed to load flagged segments:', err)
        if (!cancelled) setError('Something went wrong loading the review queue.')
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

  async function applyReviewStatus(segment: RouteSegment, reviewStatus: SegmentReviewStatus) {
    setSavingId(segment.id)
    try {
      await updateSegmentReviewStatus(segment.id, reviewStatus)
      // The row's own reviewStatus no longer matches the active filter
      // once changed, so just drop it from this list rather than
      // re-fetching the whole queue.
      setSegments((prev) => prev.filter((s) => s.id !== segment.id))
      toast.success(reviewStatus === 'excluded' ? 'Segment excluded from calculations.' : 'Segment marked verified.')
    } catch (err) {
      console.error('[DataReviewQueuePage] Failed to update review status:', err)
      toast.error('Could not save that change — please try again.')
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <DashboardHeader />
      <AdminNavTabs />

      <main className="max-w-5xl mx-auto px-4 sm:px-6 pt-6 pb-24 sm:pb-6 space-y-6">
        <div>
          <h1 className="text-lg font-semibold text-slate-800">Data Accuracy Review Queue</h1>
          <p className="text-sm text-slate-400">
            Route segments with GPS points flagged Low Accuracy or Needs Review — verify them as fine, or exclude
            their distance from KM/expense calculations. Showing up to 500 most recent per filter.
          </p>
        </div>

        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-600">{error}</div>
        )}

        <div className="rounded-2xl bg-white shadow-sm border border-slate-200 p-6">
          <div className="flex flex-wrap gap-2">
            {filterOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setFilter(opt.value)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  filter === opt.value ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
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
                  <TableRowSkeleton columns={7} />
                  <TableRowSkeleton columns={7} />
                  <TableRowSkeleton columns={7} />
                </tbody>
              </table>
            )}

            {!loading && !error && segments.length === 0 && (
              <p className="text-sm text-slate-400 text-center py-8">
                No {filterOptions.find((o) => o.value === filter)?.label.toLowerCase()} segments right now.
              </p>
            )}

            {!loading && !error && segments.length > 0 && (
              <>
                {/* Desktop table */}
                <table className="hidden sm:table w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-slate-400 border-b border-slate-200">
                      <th className="pb-2 font-medium">Employee</th>
                      <th className="pb-2 font-medium">Date</th>
                      <th className="pb-2 font-medium">Segment</th>
                      <th className="pb-2 font-medium">Distance</th>
                      <th className="pb-2 font-medium">Flag</th>
                      <th className="pb-2 font-medium">Status</th>
                      <th className="pb-2 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {segments.map((seg) => {
                      const emp = employeeById.get(seg.employeeId)
                      const attendanceLogId = attendanceLogIdBySession.get(seg.trackingSessionId)
                      return (
                        <tr key={seg.id} className="border-b border-slate-100 last:border-0">
                          <td className="py-2.5">
                            <p className="text-slate-800 font-medium">{emp?.name ?? 'Unknown'}</p>
                            <p className="text-xs text-slate-400">{emp?.employeeId ?? seg.employeeId}</p>
                          </td>
                          <td className="py-2.5 text-slate-700">{formatDateIST(seg.startTime.toDate())}</td>
                          <td className="py-2.5 text-slate-700">
                            <p className="truncate max-w-[16rem]">
                              {seg.fromLabel} &rarr; {seg.toLabel}
                            </p>
                            <p className="text-xs text-slate-400">
                              {seg.flaggedPointCount} flagged pt{seg.flaggedPointCount === 1 ? '' : 's'}
                            </p>
                          </td>
                          <td className="py-2.5 text-slate-700">{seg.distanceKm} km</td>
                          <td className="py-2.5">{seg.qualityFlag && <QualityBadge flag={seg.qualityFlag} />}</td>
                          <td className="py-2.5">
                            <ReviewStatusBadge status={seg.reviewStatus} />
                          </td>
                          <td className="py-2.5">
                            <div className="flex items-center justify-end gap-2 flex-wrap">
                              {seg.reviewStatus !== 'verified' && (
                                <button
                                  disabled={savingId === seg.id}
                                  onClick={() => applyReviewStatus(seg, 'verified')}
                                  className="rounded-lg border border-emerald-300 text-emerald-700 text-xs font-medium px-2 py-1 hover:bg-emerald-50 disabled:opacity-40"
                                >
                                  Verify
                                </button>
                              )}
                              {seg.reviewStatus !== 'excluded' && (
                                <button
                                  disabled={savingId === seg.id}
                                  onClick={() => setExcludeConfirm(seg)}
                                  className="rounded-lg border border-red-300 text-red-700 text-xs font-medium px-2 py-1 hover:bg-red-50 disabled:opacity-40"
                                >
                                  Exclude
                                </button>
                              )}
                              {attendanceLogId && (
                                <Link
                                  to={`/replay/${seg.employeeId}/${attendanceLogId}`}
                                  className="text-xs font-medium text-brand-700 hover:underline"
                                >
                                  View on Map &rarr;
                                </Link>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>

                {/* Mobile cards */}
                <div className="sm:hidden space-y-3">
                  {segments.map((seg) => {
                    const emp = employeeById.get(seg.employeeId)
                    const attendanceLogId = attendanceLogIdBySession.get(seg.trackingSessionId)
                    return (
                      <div key={seg.id} className="rounded-lg border border-slate-200 p-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-medium text-slate-800">{emp?.name ?? 'Unknown'}</p>
                            <p className="text-xs text-slate-400">{emp?.employeeId ?? seg.employeeId}</p>
                          </div>
                          <ReviewStatusBadge status={seg.reviewStatus} />
                        </div>
                        <p className="mt-2 text-sm text-slate-700 truncate">
                          {seg.fromLabel} &rarr; {seg.toLabel}
                        </p>
                        <div className="mt-1 flex items-center gap-2 flex-wrap text-xs text-slate-500">
                          <span>{formatDateIST(seg.startTime.toDate())}</span>
                          <span>{seg.distanceKm} km</span>
                          <span>
                            {seg.flaggedPointCount} flagged pt{seg.flaggedPointCount === 1 ? '' : 's'}
                          </span>
                          {seg.qualityFlag && <QualityBadge flag={seg.qualityFlag} />}
                        </div>
                        <div className="mt-2 flex items-center justify-end gap-2 flex-wrap">
                          {seg.reviewStatus !== 'verified' && (
                            <button
                              disabled={savingId === seg.id}
                              onClick={() => applyReviewStatus(seg, 'verified')}
                              className="rounded-lg border border-emerald-300 text-emerald-700 text-xs font-medium px-2 py-1 hover:bg-emerald-50 disabled:opacity-40"
                            >
                              Verify
                            </button>
                          )}
                          {seg.reviewStatus !== 'excluded' && (
                            <button
                              disabled={savingId === seg.id}
                              onClick={() => setExcludeConfirm(seg)}
                              className="rounded-lg border border-red-300 text-red-700 text-xs font-medium px-2 py-1 hover:bg-red-50 disabled:opacity-40"
                            >
                              Exclude
                            </button>
                          )}
                          {attendanceLogId && (
                            <Link
                              to={`/replay/${seg.employeeId}/${attendanceLogId}`}
                              className="text-xs font-medium text-brand-700 hover:underline"
                            >
                              View on Map &rarr;
                            </Link>
                          )}
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

      {excludeConfirm && (
        <ConfirmDialog
          title="Exclude this segment?"
          message={`This removes ${excludeConfirm.distanceKm} km from that day's GPS/eligible distance and any expense calculated from it, regardless of classification — use this when the flagged points look like bad data (spoofed/glitched GPS), not just personal travel. You can re-verify it later.`}
          confirmLabel="Exclude"
          danger
          onCancel={() => setExcludeConfirm(null)}
          onConfirm={() => {
            const seg = excludeConfirm
            setExcludeConfirm(null)
            applyReviewStatus(seg, 'excluded')
          }}
        />
      )}
    </div>
  )
}
