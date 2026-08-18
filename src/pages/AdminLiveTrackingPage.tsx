import { useEffect, useMemo, useState } from 'react'
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet'
import L from 'leaflet'
import icon2x from 'leaflet/dist/images/marker-icon-2x.png'
import icon from 'leaflet/dist/images/marker-icon.png'
import shadow from 'leaflet/dist/images/marker-shadow.png'
import 'leaflet/dist/leaflet.css'
import { getAllEmployees } from '@/services/employeeService'
import {
  subscribeToActiveTrackingSessions,
  subscribeToLatestLocationPoint,
} from '@/services/trackingService'
import type { Employee, LocationPoint, TrackingSession } from '@/types'
import DashboardHeader from '@/components/DashboardHeader'
import AdminNavTabs from '@/components/AdminNavTabs'

// Vite doesn't resolve Leaflet's default marker image paths correctly out
// of the box (they're referenced relative to leaflet.js, not the bundle) —
// without this, every marker renders as a broken image icon.
type IconDefaultWithPrivate = typeof L.Icon.Default.prototype & { _getIconUrl?: unknown }
delete (L.Icon.Default.prototype as IconDefaultWithPrivate)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: icon2x,
  iconUrl: icon,
  shadowUrl: shadow,
})

/** India centroid — only used as the map center before any live marker exists. */
const FALLBACK_CENTER: [number, number] = [20.5937, 78.9629]

interface LiveMarker {
  sessionId: string
  employeeId: string
  employeeName: string
  employeeCode: string
  lat: number
  lng: number
  address: string | null
  lastUpdate: Date | null
  speed: number | null
  batteryPercent: number | null
}

export default function AdminLiveTrackingPage() {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [activeSessions, setActiveSessions] = useState<TrackingSession[]>([])
  const [latestPoints, setLatestPoints] = useState<Record<string, LocationPoint | null>>({})
  const [sessionsLoaded, setSessionsLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getAllEmployees()
      .then(setEmployees)
      .catch((err) => {
        console.error('[AdminLiveTrackingPage] Failed to load employees:', err)
        setError('Something went wrong loading the employee list.')
      })
  }, [])

  // Live-subscribes to whichever tracking sessions are currently active —
  // markers appear/disappear on their own as people punch in/out.
  useEffect(() => {
    const unsubscribe = subscribeToActiveTrackingSessions((sessions) => {
      setActiveSessions(sessions)
      setSessionsLoaded(true)
    })
    return unsubscribe
  }, [])

  // One live location subscription per active session, torn down as
  // sessions come and go rather than left to accumulate.
  useEffect(() => {
    const unsubscribers = activeSessions.map((session) =>
      subscribeToLatestLocationPoint(session.id, (point) => {
        setLatestPoints((prev) => ({ ...prev, [session.id]: point }))
      })
    )
    return () => {
      unsubscribers.forEach((unsub) => unsub())
    }
  }, [activeSessions])

  const employeeById = useMemo(() => {
    const map = new Map<string, Employee>()
    employees.forEach((e) => map.set(e.id, e))
    return map
  }, [employees])

  const markers = useMemo<LiveMarker[]>(() => {
    return activeSessions
      .map((session): LiveMarker | null => {
        const point = latestPoints[session.id]
        if (!point) return null
        const emp = employeeById.get(session.employeeId)
        return {
          sessionId: session.id,
          employeeId: session.employeeId,
          employeeName: emp?.name ?? 'Unknown',
          employeeCode: emp?.employeeId ?? session.employeeId,
          lat: point.lat,
          lng: point.lng,
          address: point.address,
          lastUpdate: point.timestamp?.toDate?.() ?? null,
          speed: point.speed,
          batteryPercent: point.batteryPercent,
        }
      })
      .filter((m): m is LiveMarker => m !== null)
  }, [activeSessions, latestPoints, employeeById])

  const mapCenter = useMemo<[number, number]>(() => {
    if (markers.length > 0) return [markers[0].lat, markers[0].lng]
    return FALLBACK_CENTER
  }, [markers])

  const headline = !sessionsLoaded
    ? 'Loading…'
    : activeSessions.length === 0
      ? 'No employees are currently on a tracked shift'
      : `${activeSessions.length} employee${activeSessions.length === 1 ? '' : 's'} currently on a tracked shift`

  return (
    <div className="min-h-screen bg-slate-50">
      <DashboardHeader />
      <AdminNavTabs />

      <main className="max-w-5xl mx-auto px-4 sm:px-6 pt-6 pb-24 sm:pb-6 space-y-4">
        <div>
          <h1 className="text-lg font-semibold text-slate-800">Live Tracking</h1>
          <p className="text-sm text-slate-400">{headline}</p>
        </div>

        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-600">
            {error}
          </div>
        )}

        <div className="rounded-2xl bg-white shadow-sm border border-slate-200 overflow-hidden">
          {sessionsLoaded && activeSessions.length === 0 ? (
            <div className="text-center py-16">
              <svg className="mx-auto h-10 w-10 text-slate-300" viewBox="0 0 24 24" fill="none">
                <path
                  d="M12 21s-7-6.2-7-11.5A7 7 0 0112 2a7 7 0 017 7.5C19 14.8 12 21 12 21z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
                <circle cx="12" cy="9.5" r="2.3" stroke="currentColor" strokeWidth="1.5" />
              </svg>
              <p className="mt-2 text-sm text-slate-400">
                Nobody is punched in with tracking active right now.
              </p>
            </div>
          ) : (
            <>
              {sessionsLoaded && activeSessions.length > 0 && markers.length === 0 && (
                <div className="px-4 py-2 text-xs text-amber-700 bg-amber-50 border-b border-amber-100">
                  {activeSessions.length} employee{activeSessions.length === 1 ? '' : 's'} punched in, waiting for
                  the first GPS point to arrive…
                </div>
              )}
              <MapContainer
                center={mapCenter}
                zoom={markers.length > 0 ? 12 : 5}
                style={{ height: '70vh', width: '100%' }}
              >
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                {markers.map((m) => (
                  <Marker key={m.sessionId} position={[m.lat, m.lng]}>
                    <Popup>
                      <div className="text-sm">
                        <p className="font-semibold">{m.employeeName}</p>
                        <p className="text-xs text-slate-500">{m.employeeCode}</p>
                        {m.address && <p className="mt-1">{m.address}</p>}
                        <p className="mt-1 text-xs text-slate-500">
                          Last update:{' '}
                          {m.lastUpdate
                            ? m.lastUpdate.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })
                            : '—'}
                        </p>
                        {m.speed !== null && (
                          <p className="text-xs text-slate-500">Speed: {Math.round(m.speed)} km/h</p>
                        )}
                        {m.batteryPercent !== null && (
                          <p className="text-xs text-slate-500">Battery: {m.batteryPercent}%</p>
                        )}
                      </div>
                    </Popup>
                  </Marker>
                ))}
              </MapContainer>
            </>
          )}
        </div>
      </main>
    </div>
  )
}
