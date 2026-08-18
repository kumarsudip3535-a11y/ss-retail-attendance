import type { GeofenceState } from '@/hooks/useGeofenceStatus'

interface LocationStatusCardProps {
  state: GeofenceState
  onRetry: () => void
}

function formatMeters(meters: number): string {
  return meters < 1000
    ? `${Math.round(meters)}m`
    : `${(meters / 1000).toFixed(2)}km`
}

export default function LocationStatusCard({
  state,
  onRetry,
}: LocationStatusCardProps) {
  if (state.status === 'loading') {
    return (
      <div className="rounded-lg bg-slate-50 border border-slate-200 px-4 py-3 text-sm text-slate-500 flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-slate-400 animate-pulse" />
        Checking your location…
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3">
        <p className="text-sm text-amber-700">{state.message}</p>
        <button
          onClick={onRetry}
          className="mt-2 text-xs font-medium text-amber-800 hover:text-amber-900 underline"
        >
          Try again
        </button>
      </div>
    )
  }

  const { withinRange, distanceMeters, allowedRadiusMeters } = state

  return (
    <div
      className={`rounded-lg px-4 py-3 border ${
        withinRange
          ? 'bg-emerald-50 border-emerald-200'
          : 'bg-red-50 border-red-200'
      }`}
    >
      <p
        className={`text-sm font-medium ${
          withinRange ? 'text-emerald-700' : 'text-red-700'
        }`}
      >
        {withinRange
          ? 'You are within the office area.'
          : 'You are outside the permitted office location.'}
      </p>
      <p className="mt-1 text-xs text-slate-500">
        Your location: {formatMeters(distanceMeters)} from office
        {' · '}
        Allowed radius: {formatMeters(allowedRadiusMeters)}
      </p>
      <button
        onClick={onRetry}
        className="mt-2 text-xs font-medium text-slate-500 hover:text-slate-700 underline"
      >
        Refresh location
      </button>
    </div>
  )
}
