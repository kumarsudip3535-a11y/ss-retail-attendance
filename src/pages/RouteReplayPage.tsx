import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { MapContainer, TileLayer, Marker, Polyline, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import toast from 'react-hot-toast'
import { useAuth } from '@/context/AuthContext'
import { getEmployeeById } from '@/services/employeeService'
import {
  getLocationPointsForSession,
  getRouteSegmentsForSession,
  getStopsForSession,
  getTrackingSessionByAttendanceLogId,
  updateSegmentClassification,
  updateSegmentReviewStatus,
  updateStopClassification,
} from '@/services/trackingService'
import { getTrackingConfig, DEFAULT_TRACKING_CONFIG } from '@/services/trackingConfigService'
import { getVehicleForEmployee, resolveFuelRate } from '@/services/vehicleService'
import {
  ALL_REIMBURSEMENT_METHODS,
  computeDistanceBreakdown,
  computeFuelExpense,
  computeVerificationStatus,
  pickDefaultReimbursementMethod,
  REIMBURSEMENT_METHOD_OPTIONS,
} from '@/services/travelClaimService'
import { haversineDistanceMeters } from '@/services/locationService'
import type {
  Employee,
  FuelRate,
  LocationPoint,
  ReimbursementMethod,
  RouteSegment,
  SegmentReviewStatus,
  Stop,
  TrackingConfig,
  TrackingSession,
  TravelClassification,
  Vehicle,
  VerificationStatus,
} from '@/types'
import { formatDateIST } from '@/hooks/useClock'
import DashboardHeader from '@/components/DashboardHeader'
import ConfirmDialog from '@/components/ConfirmDialog'

const CLASSIFICATION_OPTIONS: TravelClassification[] = [
  'official',
  'personal',
  'lunch',
  'home',
  'customer_visit',
  'office',
  'other',
]

const VERIFICATION_STYLES: Record<VerificationStatus, { label: string; dot: string; text: string }> = {
  verified: { label: 'Verified', dot: 'bg-green-500', text: 'text-green-700' },
  needs_review: { label: 'Needs Review', dot: 'bg-amber-500', text: 'text-amber-700' },
  mismatch: { label: 'Mismatch', dot: 'bg-red-500', text: 'text-red-700' },
}

/** Phase T11: GPS quality flag badge — mirrors VERIFICATION_STYLES above. */
const QUALITY_FLAG_STYLES: Record<'low_accuracy' | 'needs_review', { label: string; bg: string; text: string }> = {
  low_accuracy: { label: 'Low Accuracy', bg: 'bg-amber-100', text: 'text-amber-700' },
  needs_review: { label: 'Needs Review', bg: 'bg-red-100', text: 'text-red-700' },
}

const REVIEW_STATUS_STYLES: Record<SegmentReviewStatus, { label: string; bg: string; text: string }> = {
  unreviewed: { label: 'Unreviewed', bg: 'bg-slate-100', text: 'text-slate-500' },
  verified: { label: 'Verified', bg: 'bg-emerald-100', text: 'text-emerald-700' },
  excluded: { label: 'Excluded', bg: 'bg-red-100', text: 'text-red-700' },
}

type PlaybackSpeed = 0.5 | 1 | 2 | 4 | 8
const SPEED_OPTIONS: PlaybackSpeed[] = [0.5, 1, 2, 4, 8]
/** Time (ms) between advancing one point at 1x playback speed. */
const BASE_FRAME_MS = 1000

function coloredDivIcon(color: string, size = 14): L.DivIcon {
  return L.divIcon({
    className: '',
    html: `<div style="width:${size}px;height:${size}px;border-radius:9999px;background:${color};border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.45);"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  })
}

const START_ICON = coloredDivIcon('#16a34a')
const END_ICON = coloredDivIcon('#dc2626')
const STOP_ICON = coloredDivIcon('#f59e0b', 16)
const CURRENT_ICON = coloredDivIcon('#2563eb', 18)

function formatClockTime(date: Date): string {
  return date.toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function prettyClassification(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase())
}

/** Fits the map to the full route exactly once, when the route first loads. */
function FitBoundsOnce({ points }: { points: LocationPoint[] }) {
  const map = useMap()
  useEffect(() => {
    if (points.length === 0) return
    const bounds = L.latLngBounds(points.map((p): [number, number] => [p.lat, p.lng]))
    map.fitBounds(bounds, { padding: [32, 32] })
    // Intentionally runs once per route load, not on every point — this is
    // an initial framing, not a follow-camera (see FollowCurrentPosition).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points.length > 0])
  return null
}

/** Pans the map to keep the current playback marker in view, when enabled. */
function FollowCurrentPosition({
  point,
  enabled,
}: {
  point: LocationPoint | null
  enabled: boolean
}) {
  const map = useMap()
  useEffect(() => {
    if (!enabled || !point) return
    map.panTo([point.lat, point.lng], { animate: true, duration: 0.3 })
  }, [point, enabled, map])
  return null
}

/** Flies the map to a stop when it's selected from the list below the map. */
function FlyToStop({ stop }: { stop: Stop | undefined }) {
  const map = useMap()
  useEffect(() => {
    if (!stop) return
    map.flyTo([stop.lat, stop.lng], 16, { animate: true, duration: 0.6 })
  }, [stop, map])
  return null
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white border border-slate-200 p-3">
      <p className="text-xs text-slate-400">{label}</p>
      <p className="mt-1 text-sm font-semibold text-slate-800 truncate">{value}</p>
    </div>
  )
}

function PlayIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M7 5v14l12-7z" />
    </svg>
  )
}
function PauseIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <rect x="6" y="5" width="4" height="14" />
      <rect x="14" y="5" width="4" height="14" />
    </svg>
  )
}
function StopIconGlyph({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <rect x="6" y="6" width="12" height="12" rx="1" />
    </svg>
  )
}
function StepBackIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M6 5h2v14H6zM20 5L10 12l10 7z" />
    </svg>
  )
}
function StepForwardIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M16 5h2v14h-2zM4 5l10 7-10 7z" />
    </svg>
  )
}
function RestartIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M4 12a8 8 0 1 1 2.5 5.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M4 17v-5h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

interface RouteReplayError {
  message: string
}

export default function RouteReplayPage() {
  const { employeeId: urlEmployeeId, attendanceLogId } = useParams<{
    employeeId: string
    attendanceLogId: string
  }>()
  const navigate = useNavigate()
  const { employee: viewer } = useAuth()
  const viewerIsAdmin = viewer?.role === 'admin'

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<RouteReplayError | null>(null)
  const [session, setSession] = useState<TrackingSession | null>(null)
  const [employee, setEmployee] = useState<Employee | null>(null)
  const [points, setPoints] = useState<LocationPoint[]>([])
  const [stops, setStops] = useState<Stop[]>([])
  const [segments, setSegments] = useState<RouteSegment[]>([])
  const [config, setConfig] = useState<TrackingConfig>(DEFAULT_TRACKING_CONFIG as TrackingConfig)

  const [currentIndex, setCurrentIndex] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [speed, setSpeed] = useState<PlaybackSpeed>(1)
  const [follow, setFollow] = useState(true)
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null)

  const [savingStopId, setSavingStopId] = useState<string | null>(null)
  const [savingSegmentId, setSavingSegmentId] = useState<string | null>(null)
  const [savingReviewStatusId, setSavingReviewStatusId] = useState<string | null>(null)
  const [excludeConfirmSegment, setExcludeConfirmSegment] = useState<RouteSegment | null>(null)

  // Phase T7: non-persisted odometer cross-check — the employee/admin types
  // in start/end odometer readings here just to see how they compare
  // against the GPS-derived distance; nothing is saved until Phase T9's
  // actual claim form exists.
  const [odometerStart, setOdometerStart] = useState('')
  const [odometerEnd, setOdometerEnd] = useState('')
  const [odometerChecked, setOdometerChecked] = useState(false)

  // Phase T8: fuel/travel expense calculation — also non-persisted, same
  // "live preview, nothing saved until T9" pattern as the T7 pieces above.
  const [vehicle, setVehicle] = useState<Vehicle | null>(null)
  const [fuelRate, setFuelRate] = useState<FuelRate | null>(null)
  const [reimbursementMethod, setReimbursementMethod] = useState<ReimbursementMethod>('fuel_mileage')
  const [manualAmountInput, setManualAmountInput] = useState('')

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

        // Phase T8: an admin is never restricted; the employee viewing
        // their own route is limited to whatever their record allows
        // (see Employee.allowedReimbursementMethods), admin-configured
        // per employee in Employee Management.
        const allowedForDefault = viewerIsAdmin
          ? ALL_REIMBURSEMENT_METHODS
          : emp?.allowedReimbursementMethods?.length
            ? emp.allowedReimbursementMethods
            : (['fuel_mileage'] as ReimbursementMethod[])
        setReimbursementMethod(pickDefaultReimbursementMethod(allowedForDefault, !!assignedVehicle))

        if (!foundSession) {
          setError({ message: 'No tracking data was recorded for this attendance record.' })
          setLoading(false)
          return
        }
        setSession(foundSession)

        const [pts, stopList, segList, resolvedFuelRate] = await Promise.all([
          getLocationPointsForSession(urlEmployeeId, foundSession.id),
          getStopsForSession(urlEmployeeId, foundSession.id),
          getRouteSegmentsForSession(urlEmployeeId, foundSession.id),
          assignedVehicle
            ? resolveFuelRate(assignedVehicle.fuelType, foundSession.startTime.toDate())
            : Promise.resolve(null),
        ])
        if (cancelled) return

        setPoints(pts)
        setStops(stopList)
        setSegments(segList)
        setFuelRate(resolvedFuelRate)

        if (pts.length === 0) {
          setError({
            message:
              foundSession.status === 'active'
                ? 'This shift is still in progress — check the Live Map for its current position. Replay becomes available once it ends.'
                : 'This shift has no recorded GPS points.',
          })
        }
      })
      .catch((err: unknown) => {
        console.error('[RouteReplayPage] Failed to load route:', err)
        if (cancelled) return
        const code = (err as { code?: string } | null)?.code
        setError({
          message:
            code === 'permission-denied'
              ? "You don't have permission to view this employee's route."
              : 'Something went wrong loading this route.',
        })
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [urlEmployeeId, attendanceLogId])

  // Playback timer — advances one point per tick; interval scales with speed.
  useEffect(() => {
    if (!isPlaying || points.length === 0) return
    if (currentIndex >= points.length - 1) {
      setIsPlaying(false)
      return
    }
    const frameMs = BASE_FRAME_MS / speed
    const timer = setTimeout(() => {
      setCurrentIndex((i) => Math.min(i + 1, points.length - 1))
    }, frameMs)
    return () => clearTimeout(timer)
  }, [isPlaying, currentIndex, points.length, speed])

  const currentPoint = points[currentIndex] ?? null

  const traveledDistanceKm = useMemo(() => {
    if (points.length < 2) return 0
    let meters = 0
    for (let i = 1; i <= currentIndex && i < points.length; i++) {
      meters += haversineDistanceMeters(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng)
    }
    return Math.round((meters / 1000) * 100) / 100
  }, [points, currentIndex])

  const fullPath = useMemo<[number, number][]>(() => points.map((p) => [p.lat, p.lng]), [points])
  const traveledPath = useMemo<[number, number][]>(
    () => fullPath.slice(0, currentIndex + 1),
    [fullPath, currentIndex]
  )

  const selectedStop = stops.find((s) => s.id === selectedStopId)

  // Phase T8: an admin reviewing/overriding a claim can pick any method;
  // an employee viewing their own route is limited to what's been
  // switched on for them in Employee Management.
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
    odometerChecked && odometerStart !== '' && odometerEnd !== ''
      ? Number(odometerEnd) - Number(odometerStart)
      : null

  const verificationStatus: VerificationStatus | null =
    odometerDistanceKm !== null
      ? computeVerificationStatus(distanceBreakdown.gpsDistanceKm, odometerDistanceKm, config.odometerToleranceKm)
      : null

  async function handleStopClassificationChange(stop: Stop, classification: TravelClassification) {
    const previous = stop.classification
    setStops((prev) => prev.map((s) => (s.id === stop.id ? { ...s, classification } : s)))
    setSavingStopId(stop.id)
    try {
      await updateStopClassification(stop.id, classification)
      toast.success('Stop reclassified.')
    } catch (err) {
      console.error('[RouteReplayPage] Failed to update stop classification:', err)
      setStops((prev) => prev.map((s) => (s.id === stop.id ? { ...s, classification: previous } : s)))
      toast.error('Could not save that change — please try again.')
    } finally {
      setSavingStopId(null)
    }
  }

  async function handleSegmentClassificationChange(segment: RouteSegment, classification: TravelClassification) {
    const previous = segment.classification
    setSegments((prev) => prev.map((s) => (s.id === segment.id ? { ...s, classification } : s)))
    setSavingSegmentId(segment.id)
    try {
      await updateSegmentClassification(segment.id, classification)
      toast.success('Segment reclassified.')
    } catch (err) {
      console.error('[RouteReplayPage] Failed to update segment classification:', err)
      setSegments((prev) => prev.map((s) => (s.id === segment.id ? { ...s, classification: previous } : s)))
      toast.error('Could not save that change — please try again.')
    } finally {
      setSavingSegmentId(null)
    }
  }

  /**
   * Phase T11: admin-only review action. 'excluded' goes through a
   * confirm dialog (handled by the caller) since it changes the actual
   * eligible-KM/expense numbers, not just a label.
   */
  async function handleSegmentReviewStatusChange(segment: RouteSegment, reviewStatus: SegmentReviewStatus) {
    const previous = segment.reviewStatus
    setSegments((prev) => prev.map((s) => (s.id === segment.id ? { ...s, reviewStatus } : s)))
    setSavingReviewStatusId(segment.id)
    try {
      await updateSegmentReviewStatus(segment.id, reviewStatus)
      toast.success(reviewStatus === 'excluded' ? 'Segment excluded from calculations.' : 'Segment marked verified.')
    } catch (err) {
      console.error('[RouteReplayPage] Failed to update segment review status:', err)
      setSegments((prev) => prev.map((s) => (s.id === segment.id ? { ...s, reviewStatus: previous } : s)))
      toast.error('Could not save that change — please try again.')
    } finally {
      setSavingReviewStatusId(null)
    }
  }

  function handleCheckOdometer() {
    if (odometerStart === '' || odometerEnd === '') {
      toast.error('Enter both start and end odometer readings.')
      return
    }
    if (Number(odometerEnd) < Number(odometerStart)) {
      toast.error('End reading must be greater than or equal to start reading.')
      return
    }
    setOdometerChecked(true)
  }

  function handleRestart() {
    setIsPlaying(false)
    setCurrentIndex(0)
  }
  function handleStop() {
    setIsPlaying(false)
  }
  function handleStepBack() {
    setIsPlaying(false)
    setCurrentIndex((i) => Math.max(i - 1, 0))
  }
  function handleStepForward() {
    setIsPlaying(false)
    setCurrentIndex((i) => Math.min(i + 1, points.length - 1))
  }
  function handleTogglePlay() {
    if (currentIndex >= points.length - 1) setCurrentIndex(0)
    setIsPlaying((p) => !p)
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <DashboardHeader />

      <main className="max-w-5xl mx-auto px-4 sm:px-6 pt-6 pb-10 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <button
              onClick={() => navigate(-1)}
              className="text-sm text-brand-700 hover:underline mb-1"
            >
              &larr; Back
            </button>
            <h1 className="text-lg font-semibold text-slate-800">Route Replay</h1>
            {employee && session && (
              <p className="text-sm text-slate-400">
                {employee.name} ({employee.employeeId}) — {formatDateIST(session.startTime.toDate())}
              </p>
            )}
          </div>
          {session && (
            <div className="text-right text-sm text-slate-500 shrink-0">
              <p>{session.totalDistanceKm !== null ? `${session.totalDistanceKm} km total` : 'Distance pending'}</p>
              <p>{session.totalPoints} GPS points</p>
              {session.status === 'completed' && urlEmployeeId && attendanceLogId && (
                <Link
                  to={`/claim/${urlEmployeeId}/${attendanceLogId}`}
                  className="inline-block mt-1 text-xs font-medium text-brand-700 hover:underline"
                >
                  Travel Claim (T9) &rarr;
                </Link>
              )}
            </div>
          )}
        </div>

        {loading && <p className="text-sm text-slate-400 py-16 text-center">Loading route…</p>}

        {!loading && error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-600">
            {error.message}
          </div>
        )}

        {!loading && !error && points.length > 0 && (
          <>
            <div className="rounded-2xl bg-white shadow-sm border border-slate-200 overflow-hidden">
              <MapContainer center={fullPath[0]} zoom={14} style={{ height: '55vh', width: '100%' }}>
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                <FitBoundsOnce points={points} />
                <FollowCurrentPosition point={currentPoint} enabled={follow} />
                <FlyToStop stop={selectedStop} />

                <Polyline positions={fullPath} pathOptions={{ color: '#94a3b8', weight: 3, opacity: 0.6 }} />
                <Polyline positions={traveledPath} pathOptions={{ color: '#2563eb', weight: 4 }} />

                <Marker position={fullPath[0]} icon={START_ICON}>
                  <Popup>Start — {formatClockTime(points[0].timestamp.toDate())}</Popup>
                </Marker>

                {session?.endTime && (
                  <Marker position={fullPath[fullPath.length - 1]} icon={END_ICON}>
                    <Popup>End — {formatClockTime(points[points.length - 1].timestamp.toDate())}</Popup>
                  </Marker>
                )}

                {stops.map((stop) => (
                  <Marker
                    key={stop.id}
                    position={[stop.lat, stop.lng]}
                    icon={STOP_ICON}
                    eventHandlers={{ click: () => setSelectedStopId(stop.id) }}
                  >
                    <Popup>
                      <div className="text-sm">
                        <p className="font-semibold">{stop.address ?? 'Stop'}</p>
                        <p className="text-xs text-slate-500">
                          {formatClockTime(stop.arrivalTime.toDate())} –{' '}
                          {stop.departureTime ? formatClockTime(stop.departureTime.toDate()) : '—'}
                        </p>
                        <p className="text-xs text-slate-500">
                          {stop.durationMinutes ?? '—'} min · {prettyClassification(stop.classification)}
                        </p>
                      </div>
                    </Popup>
                  </Marker>
                ))}

                {currentPoint && <Marker position={[currentPoint.lat, currentPoint.lng]} icon={CURRENT_ICON} />}
              </MapContainer>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <InfoTile label="Time" value={currentPoint ? formatClockTime(currentPoint.timestamp.toDate()) : '—'} />
              <InfoTile label="Distance so far" value={`${traveledDistanceKm} km`} />
              <InfoTile
                label="Speed"
                value={currentPoint?.speed != null ? `${Math.round(currentPoint.speed)} km/h` : '—'}
              />
              <InfoTile label="Address" value={currentPoint?.address ?? '—'} />
            </div>

            <div className="rounded-2xl bg-white shadow-sm border border-slate-200 p-4 space-y-3">
              <input
                type="range"
                min={0}
                max={Math.max(points.length - 1, 0)}
                value={currentIndex}
                onChange={(e) => {
                  setIsPlaying(false)
                  setCurrentIndex(Number(e.target.value))
                }}
                className="w-full accent-brand-600"
              />
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>
                  Point {currentIndex + 1} of {points.length}
                </span>
                <span>
                  {stops.length} stop{stops.length === 1 ? '' : 's'} detected
                </span>
              </div>

              <div className="flex items-center justify-center gap-2">
                <button
                  onClick={handleRestart}
                  title="Restart"
                  className="p-2 rounded-lg text-slate-500 hover:bg-slate-100"
                >
                  <RestartIcon />
                </button>
                <button
                  onClick={handleStepBack}
                  title="Back"
                  className="p-2 rounded-lg text-slate-500 hover:bg-slate-100"
                >
                  <StepBackIcon />
                </button>
                <button
                  onClick={handleTogglePlay}
                  title={isPlaying ? 'Pause' : 'Play'}
                  className="p-3 rounded-full bg-brand-600 text-white hover:bg-brand-700"
                >
                  {isPlaying ? <PauseIcon /> : <PlayIcon />}
                </button>
                <button
                  onClick={handleStop}
                  title="Stop"
                  className="p-2 rounded-lg text-slate-500 hover:bg-slate-100"
                >
                  <StopIconGlyph />
                </button>
                <button
                  onClick={handleStepForward}
                  title="Forward"
                  className="p-2 rounded-lg text-slate-500 hover:bg-slate-100"
                >
                  <StepForwardIcon />
                </button>
              </div>

              <div className="flex items-center justify-center gap-2 flex-wrap">
                {SPEED_OPTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => setSpeed(s)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                      speed === s
                        ? 'bg-brand-600 text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {s}x
                  </button>
                ))}
                <label className="ml-2 flex items-center gap-1.5 text-xs text-slate-500">
                  <input
                    type="checkbox"
                    checked={follow}
                    onChange={(e) => setFollow(e.target.checked)}
                  />
                  Follow marker
                </label>
              </div>
            </div>

            {segments.length > 0 && (
              <div className="rounded-2xl bg-white shadow-sm border border-slate-200 p-4 space-y-4">
                <div>
                  <h2 className="text-sm font-semibold text-slate-800">Eligible Distance (Phase T7)</h2>
                  <p className="text-xs text-slate-400">
                    Live estimate from this route's segments — recalculates as classifications change below.
                    Not yet saved anywhere; the actual travel claim is drafted in a later phase.
                  </p>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <InfoTile label="GPS distance" value={`${distanceBreakdown.gpsDistanceKm.toFixed(2)} km`} />
                  <InfoTile label="Personal (excluded)" value={`${distanceBreakdown.personalDistanceKm.toFixed(2)} km`} />
                  <InfoTile label="Eligible distance" value={`${distanceBreakdown.eligibleDistanceKm.toFixed(2)} km`} />
                </div>
                {distanceBreakdown.needsReview && (
                  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    This route has personal distance and the current policy ({prettyClassification(config.personalKmPolicy)})
                    flags it for manual review.
                  </p>
                )}
                {distanceBreakdown.excludedDistanceKm > 0 && (
                  <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                    {distanceBreakdown.excludedDistanceKm.toFixed(2)} km excluded from the numbers above — an admin
                    marked one or more GPS-quality-flagged segments "Excluded" below (Phase T11).
                  </p>
                )}
                {segments.some((s) => s.qualityFlag && s.reviewStatus === 'unreviewed') && (
                  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    This route has GPS-quality-flagged segments awaiting review — see Route Segments below, or the
                    Data Review queue.
                  </p>
                )}

                <div className="border-t border-slate-100 pt-4 space-y-3">
                  <h3 className="text-sm font-semibold text-slate-800">Odometer check</h3>
                  <div className="flex flex-wrap items-end gap-3">
                    <label className="text-xs text-slate-500">
                      Start (km)
                      <input
                        type="number"
                        value={odometerStart}
                        onChange={(e) => {
                          setOdometerStart(e.target.value)
                          setOdometerChecked(false)
                        }}
                        className="block mt-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm w-28"
                      />
                    </label>
                    <label className="text-xs text-slate-500">
                      End (km)
                      <input
                        type="number"
                        value={odometerEnd}
                        onChange={(e) => {
                          setOdometerEnd(e.target.value)
                          setOdometerChecked(false)
                        }}
                        className="block mt-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm w-28"
                      />
                    </label>
                    <button
                      onClick={handleCheckOdometer}
                      className="rounded-lg bg-slate-800 hover:bg-slate-900 text-white text-sm font-medium px-4 py-1.5"
                    >
                      Check
                    </button>
                    {verificationStatus && (
                      <span className={`flex items-center gap-1.5 text-sm font-medium ${VERIFICATION_STYLES[verificationStatus].text}`}>
                        <span className={`h-2.5 w-2.5 rounded-full ${VERIFICATION_STYLES[verificationStatus].dot}`} />
                        {VERIFICATION_STYLES[verificationStatus].label}
                        {odometerDistanceKm !== null && ` — odometer ${odometerDistanceKm.toFixed(2)} km`}
                      </span>
                    )}
                  </div>
                </div>

                <div className="border-t border-slate-100 pt-4 space-y-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-800">Fuel Expense (Phase T8)</h3>
                    <p className="text-xs text-slate-400">
                      {vehicle
                        ? `Vehicle: ${vehicle.vehicleNumber} (${prettyClassification(vehicle.vehicleType)}, ${prettyClassification(vehicle.fuelType)})`
                        : 'No vehicle assigned to this employee — only "Per KM" or "Manual" can be used.'}
                    </p>
                    {!viewerIsAdmin && allowedReimbursementMethods.length < ALL_REIMBURSEMENT_METHODS.length && (
                      <p className="text-xs text-slate-400">
                        Your admin has enabled:{' '}
                        {allowedReimbursementMethods
                          .map((m) => REIMBURSEMENT_METHOD_OPTIONS.find((o) => o.value === m)?.label ?? m)
                          .join(', ')}
                        .
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2">
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
                    <label className="flex items-center gap-2 text-xs text-slate-500">
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

                  {fuelExpenseResult.note ? (
                    <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                      {fuelExpenseResult.note}
                    </p>
                  ) : (
                    <div className="flex items-center justify-between rounded-lg bg-slate-50 border border-slate-200 px-4 py-3">
                      <div className="text-xs text-slate-500">
                        {reimbursementMethod === 'fuel_mileage' &&
                          fuelExpenseResult.mileageUsed !== null &&
                          fuelExpenseResult.fuelRateUsed !== null &&
                          `${distanceBreakdown.eligibleDistanceKm.toFixed(2)} km ÷ ${fuelExpenseResult.mileageUsed} km/l × ₹${fuelExpenseResult.fuelRateUsed}/l`}
                        {(reimbursementMethod === 'per_km' || reimbursementMethod === 'custom_vehicle_rate') &&
                          fuelExpenseResult.perKmRateUsed !== null &&
                          `${distanceBreakdown.eligibleDistanceKm.toFixed(2)} km × ₹${fuelExpenseResult.perKmRateUsed}/km`}
                        {reimbursementMethod === 'manual' && 'Entered directly'}
                      </div>
                      <p className="text-lg font-semibold text-slate-800">
                        ₹{fuelExpenseResult.calculatedFuelExpense.toFixed(2)}
                      </p>
                    </div>
                  )}
                  <p className="text-xs text-slate-400">
                    Fuel expense only — toll, parking and other line items are entered on the actual claim form in a later phase.
                  </p>
                </div>
              </div>
            )}

            {stops.length > 0 && (
              <div className="rounded-2xl bg-white shadow-sm border border-slate-200 p-4">
                <h2 className="text-sm font-semibold text-slate-800 mb-3">Stops ({stops.length})</h2>
                <div className="space-y-2">
                  {stops.map((stop) => (
                    <div
                      key={stop.id}
                      className={`flex items-center justify-between gap-3 text-sm border-b border-slate-100 last:border-0 pb-2 last:pb-0 ${
                        selectedStopId === stop.id ? 'bg-amber-50' : ''
                      }`}
                    >
                      <button
                        onClick={() => setSelectedStopId(stop.id)}
                        className="text-left flex-1 min-w-0"
                      >
                        <p className="text-slate-700 font-medium truncate">{stop.address ?? 'Unknown location'}</p>
                        <p className="text-xs text-slate-400">
                          {formatClockTime(stop.arrivalTime.toDate())} –{' '}
                          {stop.departureTime ? formatClockTime(stop.departureTime.toDate()) : '—'} ·{' '}
                          {stop.durationMinutes ?? '—'} min
                        </p>
                      </button>
                      <select
                        value={stop.classification}
                        disabled={savingStopId === stop.id}
                        onChange={(e) =>
                          handleStopClassificationChange(stop, e.target.value as TravelClassification)
                        }
                        className="shrink-0 rounded-lg border border-slate-300 text-xs px-2 py-1.5 disabled:opacity-50"
                      >
                        {CLASSIFICATION_OPTIONS.map((opt) => (
                          <option key={opt} value={opt}>
                            {prettyClassification(opt)}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {segments.length > 0 && (
              <div className="rounded-2xl bg-white shadow-sm border border-slate-200 p-4">
                <h2 className="text-sm font-semibold text-slate-800 mb-3">Route Segments ({segments.length})</h2>
                <div className="space-y-2">
                  {segments.map((seg) => (
                    <div
                      key={seg.id}
                      className="flex flex-wrap items-center justify-between gap-3 text-sm border-b border-slate-100 last:border-0 pb-2 last:pb-0"
                    >
                      <div className="min-w-0">
                        <p className="text-slate-700 truncate">
                          {seg.fromLabel} &rarr; {seg.toLabel}
                        </p>
                        <p className="text-xs text-slate-400">
                          {formatClockTime(seg.startTime.toDate())} – {formatClockTime(seg.endTime.toDate())} ·{' '}
                          {seg.distanceKm} km · {seg.travelTimeMinutes} min
                        </p>
                        {seg.qualityFlag && (
                          <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                            <span
                              className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${QUALITY_FLAG_STYLES[seg.qualityFlag].bg} ${QUALITY_FLAG_STYLES[seg.qualityFlag].text}`}
                            >
                              {QUALITY_FLAG_STYLES[seg.qualityFlag].label} ({seg.flaggedPointCount} pt
                              {seg.flaggedPointCount === 1 ? '' : 's'})
                            </span>
                            <span
                              className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${REVIEW_STATUS_STYLES[seg.reviewStatus].bg} ${REVIEW_STATUS_STYLES[seg.reviewStatus].text}`}
                            >
                              {REVIEW_STATUS_STYLES[seg.reviewStatus].label}
                            </span>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {viewerIsAdmin && seg.qualityFlag && (
                          <>
                            <button
                              type="button"
                              disabled={savingReviewStatusId === seg.id || seg.reviewStatus === 'verified'}
                              onClick={() => handleSegmentReviewStatusChange(seg, 'verified')}
                              className="rounded-lg border border-emerald-300 text-emerald-700 text-xs font-medium px-2 py-1.5 hover:bg-emerald-50 disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              Verify
                            </button>
                            <button
                              type="button"
                              disabled={savingReviewStatusId === seg.id || seg.reviewStatus === 'excluded'}
                              onClick={() => setExcludeConfirmSegment(seg)}
                              className="rounded-lg border border-red-300 text-red-700 text-xs font-medium px-2 py-1.5 hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              Exclude
                            </button>
                          </>
                        )}
                        <select
                          value={seg.classification}
                          disabled={savingSegmentId === seg.id}
                          onChange={(e) =>
                            handleSegmentClassificationChange(seg, e.target.value as TravelClassification)
                          }
                          className="rounded-lg border border-slate-300 text-xs px-2 py-1.5 disabled:opacity-50"
                        >
                          {CLASSIFICATION_OPTIONS.map((opt) => (
                            <option key={opt} value={opt}>
                              {prettyClassification(opt)}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {excludeConfirmSegment && (
          <ConfirmDialog
            title="Exclude this segment?"
            message={`This removes ${excludeConfirmSegment.distanceKm} km from GPS/eligible distance and any expense calculated from it, regardless of classification — use this when the flagged points look like bad data (spoofed/glitched GPS), not just personal travel. You can re-verify it later.`}
            confirmLabel="Exclude"
            danger
            onCancel={() => setExcludeConfirmSegment(null)}
            onConfirm={() => {
              const seg = excludeConfirmSegment
              setExcludeConfirmSegment(null)
              handleSegmentReviewStatusChange(seg, 'excluded')
            }}
          />
        )}
      </main>
    </div>
  )
}
