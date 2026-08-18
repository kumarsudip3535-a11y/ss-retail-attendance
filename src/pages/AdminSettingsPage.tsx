import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { useAuth } from '@/context/AuthContext'
import {
  getTrackingConfig,
  updateTrackingConfig,
  DEFAULT_TRACKING_CONFIG,
} from '@/services/trackingConfigService'
import type { PersonalKmPolicy, TrackingConfigFormInput } from '@/types'
import DashboardHeader from '@/components/DashboardHeader'
import AdminNavTabs from '@/components/AdminNavTabs'

const INTERVAL_OPTIONS: { value: TrackingConfigFormInput['collectionIntervalSeconds']; label: string }[] = [
  { value: 15, label: '15 seconds' },
  { value: 30, label: '30 seconds' },
  { value: 60, label: '1 minute' },
  { value: 300, label: '5 minutes' },
]

const PERSONAL_KM_POLICY_OPTIONS: { value: PersonalKmPolicy; label: string; hint: string }[] = [
  {
    value: 'auto_exclude',
    label: 'Auto-exclude',
    hint: 'Distance tagged "Personal" is silently subtracted from eligible KM.',
  },
  {
    value: 'manual_review',
    label: 'Manual review',
    hint: 'Personal distance is subtracted, but flagged for a human to double-check.',
  },
  {
    value: 'fully_included',
    label: 'Fully included',
    hint: 'Classification is ignored — every kilometre counts as eligible.',
  },
  {
    value: 'include_after_approval',
    label: 'Include after approval',
    hint: 'Personal distance is excluded unless a manager explicitly approves including it.',
  },
]

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return 'Something went wrong. Please try again.'
}

export default function AdminSettingsPage() {
  const { employee } = useAuth()
  const [form, setForm] = useState<TrackingConfigFormInput>(DEFAULT_TRACKING_CONFIG)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    getTrackingConfig()
      .then((config) => {
        if (cancelled) return
        const { updatedAt: _updatedAt, updatedBy: _updatedBy, ...editable } = config
        setForm(editable)
      })
      .catch((err) => {
        console.error('[AdminSettingsPage] Failed to load tracking config:', err)
        toast.error('Could not load current settings — showing defaults.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  function updateField<K extends keyof TrackingConfigFormInput>(
    key: K,
    value: TrackingConfigFormInput[K]
  ) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function handleSave() {
    if (!employee) return

    if (form.stopRadiusMeters <= 0 || form.stopMinDurationMinutes <= 0) {
      toast.error('Stop radius and minimum duration must be greater than zero.')
      return
    }
    if (
      form.lowBatteryThresholdPercent < 0 ||
      form.lowBatteryThresholdPercent > 100
    ) {
      toast.error('Battery threshold must be between 0 and 100.')
      return
    }
    if (form.odometerToleranceKm <= 0) {
      toast.error('Odometer tolerance must be greater than zero.')
      return
    }
    if (form.defaultPerKmRate <= 0) {
      toast.error('Default per-KM rate must be greater than zero.')
      return
    }

    setSaving(true)
    try {
      await updateTrackingConfig(form, employee.id)
      toast.success('Tracking settings saved.')
    } catch (error) {
      toast.error(extractErrorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <DashboardHeader />
      <AdminNavTabs />

      <main className="max-w-3xl mx-auto px-4 sm:px-6 pt-6 pb-24 sm:pb-6 space-y-6">
        <div>
          <h1 className="text-lg font-semibold text-slate-800">Tracking Settings</h1>
          <p className="text-sm text-slate-400">
            Controls how often field employees' devices report GPS location, and
            how a "Stop" is detected on their route.
          </p>
        </div>

        <div className="rounded-2xl bg-white shadow-sm border border-slate-200 p-6 space-y-6">
          {loading ? (
            <p className="text-sm text-slate-400">Loading current settings…</p>
          ) : (
            <>
              <section className="space-y-3">
                <h2 className="text-sm font-semibold text-slate-700">
                  Location collection interval
                </h2>
                <p className="text-xs text-slate-400">
                  How often an active field employee's device records a GPS
                  point. Shorter intervals give a more precise route but use
                  more battery and data.
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {INTERVAL_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => updateField('collectionIntervalSeconds', opt.value)}
                      className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                        form.collectionIntervalSeconds === opt.value
                          ? 'border-brand-600 bg-brand-50 text-brand-700'
                          : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </section>

              <section className="space-y-3">
                <h2 className="text-sm font-semibold text-slate-700">
                  Low-battery interval
                </h2>
                <p className="text-xs text-slate-400">
                  Once an employee's device battery drops below the threshold
                  below, tracking automatically switches to this wider interval
                  to conserve power.
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {INTERVAL_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => updateField('lowBatteryIntervalSeconds', opt.value)}
                      className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                        form.lowBatteryIntervalSeconds === opt.value
                          ? 'border-brand-600 bg-brand-50 text-brand-700'
                          : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <label className="flex items-center gap-2 text-xs text-slate-500">
                  Battery threshold (%)
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={form.lowBatteryThresholdPercent}
                    onChange={(e) =>
                      updateField('lowBatteryThresholdPercent', Number(e.target.value))
                    }
                    className="rounded-lg border border-slate-300 px-2 py-1 text-sm w-20"
                  />
                </label>
              </section>

              <section className="space-y-3">
                <h2 className="text-sm font-semibold text-slate-700">
                  Stop detection
                </h2>
                <p className="text-xs text-slate-400">
                  How long an employee must stay within the given radius before
                  it's recorded as a Stop on their route (e.g. a customer
                  visit), rather than just slow movement or a traffic light.
                </p>
                <div className="flex flex-wrap gap-4">
                  <label className="flex items-center gap-2 text-xs text-slate-500">
                    Minimum duration (minutes)
                    <input
                      type="number"
                      min={1}
                      value={form.stopMinDurationMinutes}
                      onChange={(e) =>
                        updateField('stopMinDurationMinutes', Number(e.target.value))
                      }
                      className="rounded-lg border border-slate-300 px-2 py-1 text-sm w-20"
                    />
                  </label>
                  <label className="flex items-center gap-2 text-xs text-slate-500">
                    Radius (meters)
                    <input
                      type="number"
                      min={10}
                      value={form.stopRadiusMeters}
                      onChange={(e) =>
                        updateField('stopRadiusMeters', Number(e.target.value))
                      }
                      className="rounded-lg border border-slate-300 px-2 py-1 text-sm w-20"
                    />
                  </label>
                </div>
              </section>

              <section className="space-y-3">
                <h2 className="text-sm font-semibold text-slate-700">
                  GPS accuracy
                </h2>
                <label className="flex items-center gap-2 text-xs text-slate-500">
                  Flag readings worse than (meters)
                  <input
                    type="number"
                    min={10}
                    value={form.lowAccuracyThresholdMeters}
                    onChange={(e) =>
                      updateField('lowAccuracyThresholdMeters', Number(e.target.value))
                    }
                    className="rounded-lg border border-slate-300 px-2 py-1 text-sm w-20"
                  />
                </label>
              </section>

              <section className="space-y-3 border-t border-slate-100 pt-6">
                <h2 className="text-sm font-semibold text-slate-700">
                  Travel Expense (Phase T7)
                </h2>
                <p className="text-xs text-slate-400">
                  How "Personal"-tagged distance affects eligible KM, and how far a
                  GPS/odometer mismatch can drift before it's flagged.
                </p>
                <div className="space-y-2">
                  {PERSONAL_KM_POLICY_OPTIONS.map((opt) => (
                    <label
                      key={opt.value}
                      className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 cursor-pointer transition-colors ${
                        form.personalKmPolicy === opt.value
                          ? 'border-brand-600 bg-brand-50'
                          : 'border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <input
                        type="radio"
                        name="personalKmPolicy"
                        className="mt-0.5"
                        checked={form.personalKmPolicy === opt.value}
                        onChange={() => updateField('personalKmPolicy', opt.value)}
                      />
                      <span>
                        <span className="block text-sm font-medium text-slate-700">
                          {opt.label}
                        </span>
                        <span className="block text-xs text-slate-400">{opt.hint}</span>
                      </span>
                    </label>
                  ))}
                </div>
                <label className="flex items-center gap-2 text-xs text-slate-500 pt-1">
                  Odometer tolerance (km) — within this, GPS vs. odometer counts as Verified
                  <input
                    type="number"
                    min={0.1}
                    step={0.1}
                    value={form.odometerToleranceKm}
                    onChange={(e) =>
                      updateField('odometerToleranceKm', Number(e.target.value))
                    }
                    className="rounded-lg border border-slate-300 px-2 py-1 text-sm w-20"
                  />
                </label>
              </section>

              <section className="space-y-3 border-t border-slate-100 pt-6">
                <h2 className="text-sm font-semibold text-slate-700">
                  Reimbursement Rates (Phase T8)
                </h2>
                <p className="text-xs text-slate-400">
                  The flat ₹/KM rate used by the "Per KM" reimbursement method. A
                  vehicle's own custom rate (set in Vehicle Management) overrides
                  this when the "Vehicle's Rate" method is used instead.
                </p>
                <label className="flex items-center gap-2 text-xs text-slate-500">
                  Default rate (₹ per km)
                  <input
                    type="number"
                    min={0.1}
                    step={0.1}
                    value={form.defaultPerKmRate}
                    onChange={(e) =>
                      updateField('defaultPerKmRate', Number(e.target.value))
                    }
                    className="rounded-lg border border-slate-300 px-2 py-1 text-sm w-20"
                  />
                </label>
              </section>

              <button
                onClick={handleSave}
                disabled={saving}
                className="w-full sm:w-auto rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-semibold px-6 py-2.5 transition-colors"
              >
                {saving ? 'Saving…' : 'Save Settings'}
              </button>
            </>
          )}
        </div>
      </main>
    </div>
  )
}
