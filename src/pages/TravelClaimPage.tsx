import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useAuth } from '@/context/AuthContext'
import { getEmployeeById } from '@/services/employeeService'
import { getRouteSegmentsForSession, getTrackingSessionByAttendanceLogId } from '@/services/trackingService'
import { getTrackingConfig, DEFAULT_TRACKING_CONFIG } from '@/services/trackingConfigService'
import { getVehicleForEmployee, resolveFuelRate } from '@/services/vehicleService'
import {
  ALL_REIMBURSEMENT_METHODS,
  approveClaim,
  computeDistanceBreakdown,
  computeFuelExpense,
  computeVerificationStatus,
  createDraftClaim,
  getClaimForSession,
  pickDefaultReimbursementMethod,
  rejectClaim,
  REIMBURSEMENT_METHOD_OPTIONS,
  saveClaim,
  sendBackClaim,
} from '@/services/travelClaimService'
import { uploadClaimReceipt } from '@/services/storageService'
import type {
  ClaimStatus,
  Employee,
  FuelRate,
  ReimbursementMethod,
  RouteSegment,
  TrackingConfig,
  TrackingSession,
  TravelClaim,
  Vehicle,
  VerificationStatus,
} from '@/types'
import { formatDateIST } from '@/hooks/useClock'
import DashboardHeader from '@/components/DashboardHeader'

const VERIFICATION_STYLES: Record<VerificationStatus, { label: string; dot: string; text: string }> = {
  verified: { label: 'Verified', dot: 'bg-green-500', text: 'text-green-700' },
  needs_review: { label: 'Needs Review', dot: 'bg-amber-500', text: 'text-amber-700' },
  mismatch: { label: 'Mismatch', dot: 'bg-red-500', text: 'text-red-700' },
}

const CLAIM_STATUS_STYLES: Record<ClaimStatus, { label: string; bg: string; text: string }> = {
  draft: { label: 'Draft', bg: 'bg-slate-100', text: 'text-slate-600' },
  submitted: { label: 'Submitted — awaiting review', bg: 'bg-blue-100', text: 'text-blue-700' },
  approved: { label: 'Approved', bg: 'bg-emerald-100', text: 'text-emerald-700' },
  rejected: { label: 'Rejected', bg: 'bg-red-100', text: 'text-red-700' },
  sent_back: { label: 'Sent back for corrections', bg: 'bg-amber-100', text: 'text-amber-700' },
}

function prettyClassification(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase())
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white border border-slate-200 p-3">
      <p className="text-xs text-slate-400">{label}</p>
      <p className="mt-1 text-sm font-semibold text-slate-800 truncate">{value}</p>
    </div>
  )
}

function StatusBadge({ status }: { status: ClaimStatus }) {
  const s = CLAIM_STATUS_STYLES[status]
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${s.bg} ${s.text}`}>
      {s.label}
    </span>
  )
}

interface ClaimPageError {
  message: string
}

export default function TravelClaimPage() {
  const { employeeId: urlEmployeeId, attendanceLogId } = useParams<{
    employeeId: string
    attendanceLogId: string
  }>()
  const navigate = useNavigate()
  const { employee: viewer } = useAuth()
  const viewerIsAdmin = viewer?.role === 'admin'
  const isOwner = viewer?.id === urlEmployeeId

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<ClaimPageError | null>(null)
  const [employee, setEmployee] = useState<Employee | null>(null)
  const [session, setSession] = useState<TrackingSession | null>(null)
  const [segments, setSegments] = useState<RouteSegment[]>([])
  const [config, setConfig] = useState<TrackingConfig>(DEFAULT_TRACKING_CONFIG as TrackingConfig)
  const [vehicle, setVehicle] = useState<Vehicle | null>(null)
  const [fuelRate, setFuelRate] = useState<FuelRate | null>(null)
  const [claim, setClaim] = useState<TravelClaim | null>(null)
  const [approverName, setApproverName] = useState<string | null>(null)

  // Editable form state — mirrors `claim` once loaded, kept separate so
  // edits don't write back to Firestore until Save Draft / Submit.
  const [reimbursementMethod, setReimbursementMethod] = useState<ReimbursementMethod>('fuel_mileage')
  const [manualAmountInput, setManualAmountInput] = useState('')
  const [odometerStart, setOdometerStart] = useState('')
  const [odometerEnd, setOdometerEnd] = useState('')
  const [tollExpense, setTollExpense] = useState('0')
  const [parkingExpense, setParkingExpense] = useState('0')
  const [otherExpense, setOtherExpense] = useState('0')
  const [notes, setNotes] = useState('')
  const [receiptUrls, setReceiptUrls] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)

  const [saving, setSaving] = useState<'draft' | 'submit' | null>(null)
  const [actioning, setActioning] = useState<'approve' | 'reject' | 'sendback' | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [sendBackReason, setSendBackReason] = useState('')
  const [showRejectForm, setShowRejectForm] = useState(false)
  const [showSendBackForm, setShowSendBackForm] = useState(false)

  useEffect(() => {
    if (!urlEmployeeId || !attendanceLogId) return
    let cancelled = false
    setLoading(true)
    setError(null)

    Promise.all([
      getEmployeeById(urlEmployeeId),
      getTrackingSessionByAttendanceLogId(urlEmployeeId, attendanceLogId),
      getTrackingConfig(),
      getVehicleForEmployee(urlEmployeeId),
    ])
      .then(async ([emp, foundSession, trackingConfig, assignedVehicle]) => {
        if (cancelled) return
        setEmployee(emp)
        setConfig(trackingConfig)
        setVehicle(assignedVehicle)

        if (!foundSession) {
          setError({ message: 'No tracking data was recorded for this attendance record.' })
          setLoading(false)
          return
        }
        if (foundSession.status !== 'completed') {
          setError({ message: 'This shift is still in progress — a travel claim can only be created once it ends.' })
          setLoading(false)
          return
        }
        setSession(foundSession)

        const [segList, resolvedFuelRate, existingClaim] = await Promise.all([
          getRouteSegmentsForSession(urlEmployeeId, foundSession.id),
          assignedVehicle
            ? resolveFuelRate(assignedVehicle.fuelType, foundSession.startTime.toDate())
            : Promise.resolve(null),
          getClaimForSession(foundSession.id),
        ])
        if (cancelled) return
        setSegments(segList)
        setFuelRate(resolvedFuelRate)

        if (existingClaim) {
          setClaim(existingClaim)
          setReimbursementMethod(existingClaim.reimbursementMethod)
          setManualAmountInput(
            existingClaim.reimbursementMethod === 'manual' ? String(existingClaim.calculatedFuelExpense) : ''
          )
          setOdometerStart(existingClaim.odometerStartKm !== null ? String(existingClaim.odometerStartKm) : '')
          setOdometerEnd(existingClaim.odometerEndKm !== null ? String(existingClaim.odometerEndKm) : '')
          setTollExpense(String(existingClaim.tollExpense))
          setParkingExpense(String(existingClaim.parkingExpense))
          setOtherExpense(String(existingClaim.otherExpense))
          setNotes(existingClaim.notes ?? '')
          setReceiptUrls(existingClaim.receiptUrls)
          if (existingClaim.approvedBy) {
            getEmployeeById(existingClaim.approvedBy).then((approver) => {
              if (!cancelled) setApproverName(approver?.name ?? null)
            })
          }
        } else {
          // Phase T9's "auto-generated daily Travel Claim draft" — see
          // createDraftClaim's doc comment for why this happens here
          // (lazily, on first visit) rather than via a Cloud Function.
          const breakdown = computeDistanceBreakdown(segList, trackingConfig.personalKmPolicy)
          const allowed: ReimbursementMethod[] = emp?.allowedReimbursementMethods?.length
            ? emp.allowedReimbursementMethods
            : ['fuel_mileage']
          const defaultMethod = pickDefaultReimbursementMethod(allowed, !!assignedVehicle)
          const fuelResult = computeFuelExpense(
            defaultMethod,
            breakdown.eligibleDistanceKm,
            assignedVehicle,
            resolvedFuelRate,
            trackingConfig.defaultPerKmRate,
            null
          )
          const draftInput = {
            employeeId: urlEmployeeId,
            trackingSessionId: foundSession.id,
            attendanceLogId,
            date: foundSession.startTime,
            vehicleId: assignedVehicle?.id ?? null,
            gpsDistanceKm: breakdown.gpsDistanceKm,
            eligibleDistanceKm: breakdown.eligibleDistanceKm,
            personalDistanceKm: breakdown.personalDistanceKm,
            odometerStartKm: null,
            odometerEndKm: null,
            odometerDistanceKm: null,
            reimbursementMethod: defaultMethod,
            mileageUsed: fuelResult.mileageUsed,
            fuelRateUsed: fuelResult.fuelRateUsed,
            perKmRateUsed: fuelResult.perKmRateUsed,
            calculatedFuelExpense: fuelResult.calculatedFuelExpense,
            tollExpense: 0,
            parkingExpense: 0,
            otherExpense: 0,
            notes: null,
            receiptUrls: [] as string[],
            totalClaim: fuelResult.calculatedFuelExpense,
            verificationStatus: 'needs_review' as VerificationStatus,
          }
          await createDraftClaim(foundSession.id, draftInput)
          if (cancelled) return
          setClaim({ id: foundSession.id, status: 'draft', approvedBy: null, approvedAt: null, rejectionReason: null, ...draftInput })
          setReimbursementMethod(defaultMethod)
        }
      })
      .catch((err: unknown) => {
        console.error('[TravelClaimPage] Failed to load claim:', err)
        if (cancelled) return
        const code = (err as { code?: string } | null)?.code
        setError({
          message:
            code === 'permission-denied'
              ? "You don't have permission to view this employee's travel claim."
              : 'Something went wrong loading this travel claim.',
        })
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [urlEmployeeId, attendanceLogId])

  const allowedReimbursementMethods: ReimbursementMethod[] = viewerIsAdmin
    ? ALL_REIMBURSEMENT_METHODS
    : employee?.allowedReimbursementMethods?.length
      ? employee.allowedReimbursementMethods
      : ['fuel_mileage']

  const distanceBreakdown = useMemo(
    () => computeDistanceBreakdown(segments, config.personalKmPolicy),
    [segments, config.personalKmPolicy]
  )

  const fuelExpenseResult = useMemo(
    () =>
      computeFuelExpense(
        reimbursementMethod,
        distanceBreakdown.eligibleDistanceKm,
        vehicle,
        fuelRate,
        config.defaultPerKmRate,
        manualAmountInput === '' ? null : Number(manualAmountInput)
      ),
    [reimbursementMethod, distanceBreakdown.eligibleDistanceKm, vehicle, fuelRate, config.defaultPerKmRate, manualAmountInput]
  )

  const odometerDistanceKm =
    odometerStart !== '' && odometerEnd !== '' ? Number(odometerEnd) - Number(odometerStart) : null

  const liveVerificationStatus: VerificationStatus =
    odometerDistanceKm !== null
      ? computeVerificationStatus(distanceBreakdown.gpsDistanceKm, odometerDistanceKm, config.odometerToleranceKm)
      : 'needs_review'

  const totalClaim =
    fuelExpenseResult.calculatedFuelExpense +
    (Number(tollExpense) || 0) +
    (Number(parkingExpense) || 0) +
    (Number(otherExpense) || 0)

  // Editable only by the claim's own employee, and only while it's in a
  // state that isn't waiting on / already through a manager's decision.
  const isEditable = !!claim && isOwner && !viewerIsAdmin && (claim.status === 'draft' || claim.status === 'sent_back')

  async function handleReceiptUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !claim || !urlEmployeeId) return
    setUploading(true)
    try {
      const url = await uploadClaimReceipt(urlEmployeeId, claim.id, file)
      setReceiptUrls((prev) => [...prev, url])
      toast.success('Receipt uploaded — click Save Draft or Submit to keep it attached.')
    } catch (err) {
      console.error('[TravelClaimPage] Receipt upload failed:', err)
      toast.error('Could not upload that file. Please try again.')
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  function removeReceipt(url: string) {
    setReceiptUrls((prev) => prev.filter((u) => u !== url))
  }

  function buildSavePayload(status: ClaimStatus) {
    return {
      reimbursementMethod,
      mileageUsed: fuelExpenseResult.mileageUsed,
      fuelRateUsed: fuelExpenseResult.fuelRateUsed,
      perKmRateUsed: fuelExpenseResult.perKmRateUsed,
      calculatedFuelExpense: fuelExpenseResult.calculatedFuelExpense,
      odometerStartKm: odometerStart === '' ? null : Number(odometerStart),
      odometerEndKm: odometerEnd === '' ? null : Number(odometerEnd),
      odometerDistanceKm,
      verificationStatus: liveVerificationStatus,
      tollExpense: Number(tollExpense) || 0,
      parkingExpense: Number(parkingExpense) || 0,
      otherExpense: Number(otherExpense) || 0,
      notes: notes.trim() || null,
      receiptUrls,
      totalClaim,
      status,
    }
  }

  async function handleSaveDraft() {
    if (!claim) return
    setSaving('draft')
    try {
      await saveClaim(claim.id, buildSavePayload('draft'))
      toast.success('Draft saved.')
      setClaim((prev) => (prev ? { ...prev, ...buildSavePayload('draft') } : prev))
    } catch (err) {
      console.error('[TravelClaimPage] Save draft failed:', err)
      toast.error('Could not save. Please try again.')
    } finally {
      setSaving(null)
    }
  }

  async function handleSubmit() {
    if (!claim) return
    if (fuelExpenseResult.note) {
      toast.error('Fix the reimbursement method before submitting — see the note above the amount.')
      return
    }
    if ((odometerStart === '') !== (odometerEnd === '')) {
      toast.error('Enter both odometer readings, or leave both blank.')
      return
    }
    setSaving('submit')
    try {
      await saveClaim(claim.id, buildSavePayload('submitted'))
      toast.success('Travel claim submitted for approval.')
      setClaim((prev) => (prev ? { ...prev, ...buildSavePayload('submitted') } : prev))
    } catch (err) {
      console.error('[TravelClaimPage] Submit failed:', err)
      toast.error('Could not submit. Please try again.')
    } finally {
      setSaving(null)
    }
  }

  async function handleApprove() {
    if (!claim || !viewer) return
    setActioning('approve')
    try {
      await approveClaim(claim.id, viewer.id)
      toast.success('Claim approved.')
      setClaim((prev) => (prev ? { ...prev, status: 'approved', approvedBy: viewer.id } : prev))
      setApproverName(viewer.name)
    } catch (err) {
      console.error('[TravelClaimPage] Approve failed:', err)
      toast.error('Could not approve. Please try again.')
    } finally {
      setActioning(null)
    }
  }

  async function handleReject() {
    if (!claim || !viewer) return
    if (!rejectReason.trim()) {
      toast.error('Enter a reason for rejecting this claim.')
      return
    }
    setActioning('reject')
    try {
      await rejectClaim(claim.id, viewer.id, rejectReason.trim())
      toast.success('Claim rejected.')
      setClaim((prev) => (prev ? { ...prev, status: 'rejected', approvedBy: viewer.id, rejectionReason: rejectReason.trim() } : prev))
      setApproverName(viewer.name)
      setShowRejectForm(false)
    } catch (err) {
      console.error('[TravelClaimPage] Reject failed:', err)
      toast.error('Could not reject. Please try again.')
    } finally {
      setActioning(null)
    }
  }

  async function handleSendBack() {
    if (!claim || !viewer) return
    if (!sendBackReason.trim()) {
      toast.error('Enter what needs to be corrected.')
      return
    }
    setActioning('sendback')
    try {
      await sendBackClaim(claim.id, viewer.id, sendBackReason.trim())
      toast.success('Sent back to the employee for corrections.')
      setClaim((prev) => (prev ? { ...prev, status: 'sent_back', rejectionReason: sendBackReason.trim() } : prev))
      setShowSendBackForm(false)
    } catch (err) {
      console.error('[TravelClaimPage] Send back failed:', err)
      toast.error('Could not send back. Please try again.')
    } finally {
      setActioning(null)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <DashboardHeader />

      <main className="max-w-3xl mx-auto px-4 sm:px-6 pt-6 pb-10 space-y-4">
        <div>
          <button onClick={() => navigate(-1)} className="text-sm text-brand-700 hover:underline mb-1">
            &larr; Back
          </button>
          <h1 className="text-lg font-semibold text-slate-800">Travel Claim</h1>
          {employee && session && (
            <p className="text-sm text-slate-400">
              {employee.name} ({employee.employeeId}) — {formatDateIST(session.startTime.toDate())}
            </p>
          )}
        </div>

        {loading && <p className="text-sm text-slate-400 py-16 text-center">Loading claim…</p>}

        {!loading && error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-600">{error.message}</div>
        )}

        {!loading && !error && claim && session && (
          <>
            <div className="flex items-center justify-between">
              <StatusBadge status={claim.status} />
              {urlEmployeeId && attendanceLogId && (
                <Link
                  to={`/replay/${urlEmployeeId}/${attendanceLogId}`}
                  className="text-xs font-medium text-brand-700 hover:underline"
                >
                  View Route Replay &rarr;
                </Link>
              )}
            </div>

            {claim.status === 'sent_back' && claim.rejectionReason && (
              <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
                <p className="font-medium">Sent back for corrections:</p>
                <p className="mt-0.5">{claim.rejectionReason}</p>
              </div>
            )}

            {claim.status === 'rejected' && claim.rejectionReason && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                <p className="font-medium">Rejected:</p>
                <p className="mt-0.5">{claim.rejectionReason}</p>
              </div>
            )}

            {claim.status === 'approved' && (
              <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-700">
                Approved{approverName ? ` by ${approverName}` : ''}
                {claim.approvedAt ? ` on ${formatDateIST(claim.approvedAt.toDate())}` : ''}.
              </div>
            )}

            <div className="rounded-2xl bg-white shadow-sm border border-slate-200 p-4 space-y-4">
              <div>
                <h2 className="text-sm font-semibold text-slate-800">Distance</h2>
                <div className="mt-2 grid grid-cols-3 gap-3">
                  <InfoTile label="GPS distance" value={`${distanceBreakdown.gpsDistanceKm.toFixed(2)} km`} />
                  <InfoTile label="Personal (excluded)" value={`${distanceBreakdown.personalDistanceKm.toFixed(2)} km`} />
                  <InfoTile label="Eligible distance" value={`${distanceBreakdown.eligibleDistanceKm.toFixed(2)} km`} />
                </div>
              </div>

              <div className="border-t border-slate-100 pt-4">
                <h2 className="text-sm font-semibold text-slate-800">Odometer</h2>
                {isEditable ? (
                  <div className="mt-2 flex flex-wrap items-end gap-3">
                    <label className="text-xs text-slate-500">
                      Start (km)
                      <input
                        type="number"
                        value={odometerStart}
                        onChange={(e) => setOdometerStart(e.target.value)}
                        className="block mt-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm w-28"
                      />
                    </label>
                    <label className="text-xs text-slate-500">
                      End (km)
                      <input
                        type="number"
                        value={odometerEnd}
                        onChange={(e) => setOdometerEnd(e.target.value)}
                        className="block mt-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm w-28"
                      />
                    </label>
                    {odometerDistanceKm !== null && (
                      <span className={`flex items-center gap-1.5 text-sm font-medium ${VERIFICATION_STYLES[liveVerificationStatus].text}`}>
                        <span className={`h-2.5 w-2.5 rounded-full ${VERIFICATION_STYLES[liveVerificationStatus].dot}`} />
                        {VERIFICATION_STYLES[liveVerificationStatus].label} — {odometerDistanceKm.toFixed(2)} km
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="mt-2 flex items-center gap-3 text-sm text-slate-600">
                    {claim.odometerStartKm !== null && claim.odometerEndKm !== null ? (
                      <>
                        <span>
                          {claim.odometerStartKm} km &rarr; {claim.odometerEndKm} km
                        </span>
                        <span className={`flex items-center gap-1.5 font-medium ${VERIFICATION_STYLES[claim.verificationStatus].text}`}>
                          <span className={`h-2.5 w-2.5 rounded-full ${VERIFICATION_STYLES[claim.verificationStatus].dot}`} />
                          {VERIFICATION_STYLES[claim.verificationStatus].label}
                        </span>
                      </>
                    ) : (
                      <span className="text-slate-400">No odometer reading recorded.</span>
                    )}
                  </div>
                )}
              </div>

              <div className="border-t border-slate-100 pt-4">
                <h2 className="text-sm font-semibold text-slate-800">Fuel Expense</h2>
                <p className="text-xs text-slate-400">
                  {vehicle
                    ? `Vehicle: ${vehicle.vehicleNumber} (${prettyClassification(vehicle.vehicleType)}, ${prettyClassification(vehicle.fuelType)})`
                    : 'No vehicle assigned to this employee.'}
                </p>

                {isEditable ? (
                  <>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {REIMBURSEMENT_METHOD_OPTIONS.filter((opt) => allowedReimbursementMethods.includes(opt.value)).map(
                        (opt) => {
                          const disabled = !vehicle && (opt.value === 'fuel_mileage' || opt.value === 'custom_vehicle_rate')
                          return (
                            <button
                              key={opt.value}
                              type="button"
                              disabled={disabled}
                              onClick={() => setReimbursementMethod(opt.value)}
                              className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                                reimbursementMethod === opt.value
                                  ? 'border-brand-600 bg-brand-50 text-brand-700'
                                  : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                              }`}
                            >
                              {opt.label}
                            </button>
                          )
                        }
                      )}
                    </div>
                    {reimbursementMethod === 'manual' && (
                      <label className="mt-2 flex items-center gap-2 text-xs text-slate-500">
                        Amount (₹)
                        <input
                          type="number"
                          min={0}
                          value={manualAmountInput}
                          onChange={(e) => setManualAmountInput(e.target.value)}
                          className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm w-28"
                        />
                      </label>
                    )}
                  </>
                ) : (
                  <p className="mt-1 text-sm text-slate-600">
                    {REIMBURSEMENT_METHOD_OPTIONS.find((o) => o.value === claim.reimbursementMethod)?.label}
                  </p>
                )}

                {fuelExpenseResult.note ? (
                  <p className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    {fuelExpenseResult.note}
                  </p>
                ) : (
                  <div className="mt-2 flex items-center justify-between rounded-lg bg-slate-50 border border-slate-200 px-4 py-3">
                    <span className="text-xs text-slate-500">Calculated fuel expense</span>
                    <span className="text-base font-semibold text-slate-800">
                      ₹{(isEditable ? fuelExpenseResult.calculatedFuelExpense : claim.calculatedFuelExpense).toFixed(2)}
                    </span>
                  </div>
                )}
              </div>

              <div className="border-t border-slate-100 pt-4">
                <h2 className="text-sm font-semibold text-slate-800">Other Expenses</h2>
                {isEditable ? (
                  <div className="mt-2 grid grid-cols-3 gap-3">
                    <label className="text-xs text-slate-500">
                      Toll (₹)
                      <input
                        type="number"
                        min={0}
                        value={tollExpense}
                        onChange={(e) => setTollExpense(e.target.value)}
                        className="block mt-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm w-full"
                      />
                    </label>
                    <label className="text-xs text-slate-500">
                      Parking (₹)
                      <input
                        type="number"
                        min={0}
                        value={parkingExpense}
                        onChange={(e) => setParkingExpense(e.target.value)}
                        className="block mt-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm w-full"
                      />
                    </label>
                    <label className="text-xs text-slate-500">
                      Other (₹)
                      <input
                        type="number"
                        min={0}
                        value={otherExpense}
                        onChange={(e) => setOtherExpense(e.target.value)}
                        className="block mt-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm w-full"
                      />
                    </label>
                  </div>
                ) : (
                  <div className="mt-2 grid grid-cols-3 gap-3">
                    <InfoTile label="Toll" value={`₹${claim.tollExpense.toFixed(2)}`} />
                    <InfoTile label="Parking" value={`₹${claim.parkingExpense.toFixed(2)}`} />
                    <InfoTile label="Other" value={`₹${claim.otherExpense.toFixed(2)}`} />
                  </div>
                )}
              </div>

              <div className="border-t border-slate-100 pt-4">
                <h2 className="text-sm font-semibold text-slate-800">Notes</h2>
                {isEditable ? (
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={3}
                    placeholder="Anything the approver should know…"
                    className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500"
                  />
                ) : (
                  <p className="mt-1 text-sm text-slate-600">{claim.notes || <span className="text-slate-400">No notes.</span>}</p>
                )}
              </div>

              <div className="border-t border-slate-100 pt-4">
                <h2 className="text-sm font-semibold text-slate-800">Receipts</h2>
                {receiptUrls.length === 0 && !isEditable && (
                  <p className="mt-1 text-sm text-slate-400">No receipts attached.</p>
                )}
                {receiptUrls.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {receiptUrls.map((url, i) => (
                      <li key={url} className="flex items-center justify-between text-sm">
                        <a
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-brand-700 hover:underline truncate"
                        >
                          Receipt {i + 1}
                        </a>
                        {isEditable && (
                          <button
                            onClick={() => removeReceipt(url)}
                            className="text-xs text-red-500 hover:text-red-600 ml-3 shrink-0"
                          >
                            Remove
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {isEditable && (
                  <label className="mt-2 inline-block text-xs font-medium text-brand-600 hover:text-brand-700 cursor-pointer">
                    {uploading ? 'Uploading…' : '+ Attach receipt'}
                    <input
                      type="file"
                      accept="image/*,application/pdf"
                      onChange={handleReceiptUpload}
                      disabled={uploading}
                      className="hidden"
                    />
                  </label>
                )}
              </div>

              <div className="border-t border-slate-100 pt-4 flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-800">Total Claim</span>
                <span className="text-xl font-bold text-slate-800">
                  ₹{(isEditable ? totalClaim : claim.totalClaim).toFixed(2)}
                </span>
              </div>
            </div>

            {isEditable && (
              <div className="flex gap-3">
                <button
                  onClick={handleSaveDraft}
                  disabled={saving !== null}
                  className="flex-1 rounded-lg border border-slate-300 text-slate-700 text-sm font-medium py-2.5 hover:bg-slate-50 disabled:opacity-50"
                >
                  {saving === 'draft' ? 'Saving…' : 'Save Draft'}
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={saving !== null}
                  className="flex-1 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-semibold py-2.5"
                >
                  {saving === 'submit' ? 'Submitting…' : 'Submit'}
                </button>
              </div>
            )}

            {viewerIsAdmin && claim.status === 'submitted' && (
              <div className="rounded-2xl bg-white shadow-sm border border-slate-200 p-4 space-y-3">
                <h2 className="text-sm font-semibold text-slate-800">Manager Decision</h2>

                {!showRejectForm && !showSendBackForm && (
                  <div className="flex flex-wrap gap-3">
                    <button
                      onClick={handleApprove}
                      disabled={actioning !== null}
                      className="rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2"
                    >
                      {actioning === 'approve' ? 'Approving…' : 'Approve'}
                    </button>
                    <button
                      onClick={() => setShowSendBackForm(true)}
                      disabled={actioning !== null}
                      className="rounded-lg border border-amber-300 text-amber-700 text-sm font-medium px-4 py-2 hover:bg-amber-50 disabled:opacity-50"
                    >
                      Send Back
                    </button>
                    <button
                      onClick={() => setShowRejectForm(true)}
                      disabled={actioning !== null}
                      className="rounded-lg border border-red-300 text-red-600 text-sm font-medium px-4 py-2 hover:bg-red-50 disabled:opacity-50"
                    >
                      Reject
                    </button>
                  </div>
                )}

                {showSendBackForm && (
                  <div className="space-y-2">
                    <label className="block text-xs font-medium text-slate-600">
                      What needs to be corrected?
                    </label>
                    <textarea
                      value={sendBackReason}
                      onChange={(e) => setSendBackReason(e.target.value)}
                      rows={2}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-amber-500"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => setShowSendBackForm(false)}
                        className="rounded-lg border border-slate-300 text-slate-700 text-sm font-medium px-4 py-2 hover:bg-slate-50"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleSendBack}
                        disabled={actioning !== null}
                        className="rounded-lg bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2"
                      >
                        {actioning === 'sendback' ? 'Sending…' : 'Confirm Send Back'}
                      </button>
                    </div>
                  </div>
                )}

                {showRejectForm && (
                  <div className="space-y-2">
                    <label className="block text-xs font-medium text-slate-600">Reason for rejection</label>
                    <textarea
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      rows={2}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-red-500"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => setShowRejectForm(false)}
                        className="rounded-lg border border-slate-300 text-slate-700 text-sm font-medium px-4 py-2 hover:bg-slate-50"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleReject}
                        disabled={actioning !== null}
                        className="rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2"
                      >
                        {actioning === 'reject' ? 'Rejecting…' : 'Confirm Reject'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}
