import { useState } from 'react'
import toast from 'react-hot-toast'
import { Timestamp } from 'firebase/firestore'
import { createFuelRate } from '@/services/vehicleService'
import type { FuelType } from '@/types'

interface FuelRateFormModalProps {
  onClose: () => void
  onSaved: () => void
}

const FUEL_TYPES: { value: FuelType; label: string }[] = [
  { value: 'petrol', label: 'Petrol' },
  { value: 'diesel', label: 'Diesel' },
  { value: 'cng', label: 'CNG' },
  { value: 'electric', label: 'Electric' },
  { value: 'other', label: 'Other' },
]

function toDateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/**
 * Add-only by design — there is no edit form for an existing fuel rate.
 * Per vehicleService.ts's createFuelRate doc comment, history is never
 * rewritten so past claims stay accurate; a mistaken entry gets
 * deactivated (from the list) and a corrected one added here instead.
 */
export default function FuelRateFormModal({ onClose, onSaved }: FuelRateFormModalProps) {
  const [fuelType, setFuelType] = useState<FuelType>('petrol')
  const [ratePerLiter, setRatePerLiter] = useState('')
  const [effectiveDate, setEffectiveDate] = useState(toDateInputValue(new Date()))
  const [location, setLocation] = useState('')
  const [source, setSource] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function validate(): string | null {
    const rate = parseFloat(ratePerLiter)
    if (!Number.isFinite(rate) || rate <= 0) return 'Rate per litre must be a positive number.'
    if (!effectiveDate) return 'Effective date is required.'
    return null
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const validationError = validate()
    if (validationError) {
      setError(validationError)
      return
    }

    setError(null)
    setSaving(true)

    try {
      await createFuelRate({
        fuelType,
        ratePerLiter: parseFloat(ratePerLiter),
        effectiveDate: Timestamp.fromDate(new Date(`${effectiveDate}T00:00:00`)),
        location: location.trim() || null,
        source: source.trim() || null,
        active: true,
      })
      toast.success('Fuel rate added.')
      onSaved()
      onClose()
    } catch (err) {
      console.error('[FuelRateFormModal] Save failed:', err)
      setError('Something went wrong. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center px-4 py-8 overflow-y-auto">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-lg p-6">
        <h2 className="text-lg font-semibold text-slate-800">Add Fuel Rate</h2>
        <p className="mt-1 text-xs text-slate-400">
          This adds a new dated entry — it never overwrites an existing one, so past expense
          calculations keep using the rate that was actually in effect at the time.
        </p>

        {error && (
          <div className="mt-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Fuel Type</label>
              <select
                value={fuelType}
                onChange={(e) => setFuelType(e.target.value as FuelType)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500"
              >
                {FUEL_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Rate (₹/litre)
              </label>
              <input
                value={ratePerLiter}
                onChange={(e) => setRatePerLiter(e.target.value)}
                inputMode="decimal"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Effective Date
            </label>
            <input
              type="date"
              value={effectiveDate}
              onChange={(e) => setEffectiveDate(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Location <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="e.g. Bengaluru"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Source <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <input
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="e.g. IOCL published rate"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg border border-slate-300 text-slate-700 text-sm font-medium py-2.5 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-semibold py-2.5"
            >
              {saving ? 'Saving…' : 'Add Fuel Rate'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
