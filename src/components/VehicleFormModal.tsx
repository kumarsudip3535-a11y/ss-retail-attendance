import { useState } from 'react'
import toast from 'react-hot-toast'
import { createVehicle, updateVehicle } from '@/services/vehicleService'
import type { Employee, FuelType, Vehicle, VehicleType } from '@/types'

interface VehicleFormModalProps {
  /** Present when editing; undefined when creating a new vehicle. */
  vehicle?: Vehicle
  employees: Employee[]
  onClose: () => void
  onSaved: () => void
}

const VEHICLE_TYPES: { value: VehicleType; label: string }[] = [
  { value: 'motorcycle', label: 'Motorcycle' },
  { value: 'scooter', label: 'Scooter' },
  { value: 'car', label: 'Car' },
  { value: 'van', label: 'Van' },
  { value: 'other', label: 'Other' },
]

const FUEL_TYPES: { value: FuelType; label: string }[] = [
  { value: 'petrol', label: 'Petrol' },
  { value: 'diesel', label: 'Diesel' },
  { value: 'cng', label: 'CNG' },
  { value: 'electric', label: 'Electric' },
  { value: 'other', label: 'Other' },
]

export default function VehicleFormModal({
  vehicle,
  employees,
  onClose,
  onSaved,
}: VehicleFormModalProps) {
  const isEditing = !!vehicle

  const [vehicleNumber, setVehicleNumber] = useState(vehicle?.vehicleNumber ?? '')
  const [vehicleType, setVehicleType] = useState<VehicleType>(vehicle?.vehicleType ?? 'motorcycle')
  const [fuelType, setFuelType] = useState<FuelType>(vehicle?.fuelType ?? 'petrol')
  const [mileage, setMileage] = useState(vehicle ? String(vehicle.mileage) : '')
  const [fuelReimbursementRate, setFuelReimbursementRate] = useState(
    vehicle?.fuelReimbursementRate != null ? String(vehicle.fuelReimbursementRate) : ''
  )
  const [perKmRate, setPerKmRate] = useState(
    vehicle?.perKmRate != null ? String(vehicle.perKmRate) : ''
  )
  const [assignedEmployeeId, setAssignedEmployeeId] = useState(
    vehicle?.assignedEmployeeId ?? ''
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function validate(): string | null {
    if (!vehicleNumber.trim()) return 'Vehicle number is required.'
    const mileageNum = parseFloat(mileage)
    if (!Number.isFinite(mileageNum) || mileageNum <= 0)
      return 'Mileage must be a positive number.'
    if (fuelReimbursementRate.trim()) {
      const rate = parseFloat(fuelReimbursementRate)
      if (!Number.isFinite(rate) || rate <= 0)
        return 'Fuel reimbursement rate override must be a positive number, or left blank.'
    }
    if (perKmRate.trim()) {
      const rate = parseFloat(perKmRate)
      if (!Number.isFinite(rate) || rate <= 0)
        return 'Per-KM rate override must be a positive number, or left blank.'
    }
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
      const data = {
        vehicleNumber: vehicleNumber.trim().toUpperCase(),
        vehicleType,
        fuelType,
        mileage: parseFloat(mileage),
        fuelReimbursementRate: fuelReimbursementRate.trim()
          ? parseFloat(fuelReimbursementRate)
          : null,
        perKmRate: perKmRate.trim() ? parseFloat(perKmRate) : null,
        assignedEmployeeId: assignedEmployeeId || null,
      }

      if (isEditing) {
        await updateVehicle(vehicle.id, data)
        toast.success('Vehicle updated.')
      } else {
        await createVehicle({ ...data, active: true })
        toast.success('Vehicle added.')
      }

      onSaved()
      onClose()
    } catch (err) {
      console.error('[VehicleFormModal] Save failed:', err)
      setError('Something went wrong. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center px-4 py-8 overflow-y-auto">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-lg p-6">
        <h2 className="text-lg font-semibold text-slate-800">
          {isEditing ? 'Edit Vehicle' : 'Add Vehicle'}
        </h2>

        {error && (
          <div className="mt-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Vehicle Number
            </label>
            <input
              value={vehicleNumber}
              onChange={(e) => setVehicleNumber(e.target.value)}
              placeholder="e.g. KA01AB1234"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Vehicle Type
              </label>
              <select
                value={vehicleType}
                onChange={(e) => setVehicleType(e.target.value as VehicleType)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500"
              >
                {VEHICLE_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Fuel Type
              </label>
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
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Mileage (km/litre{fuelType === 'electric' ? ' equivalent' : ''})
            </label>
            <input
              value={mileage}
              onChange={(e) => setMileage(e.target.value)}
              inputMode="decimal"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Fuel Rate Override (₹/L)
              </label>
              <input
                value={fuelReimbursementRate}
                onChange={(e) => setFuelReimbursementRate(e.target.value)}
                placeholder="Use fuel rate table"
                inputMode="decimal"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Per-KM Rate (₹/km)
              </label>
              <input
                value={perKmRate}
                onChange={(e) => setPerKmRate(e.target.value)}
                placeholder="Optional"
                inputMode="decimal"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
          </div>
          <p className="-mt-2 text-xs text-slate-400">
            Leave rate overrides blank to use the shared Fuel Rate table and mileage-based
            calculation instead of a fixed rate for this vehicle (Phase T8 decides which method
            applies).
          </p>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Assigned Employee
            </label>
            <select
              value={assignedEmployeeId}
              onChange={(e) => setAssignedEmployeeId(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="">Unassigned</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.name} ({emp.employeeId})
                </option>
              ))}
            </select>
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
              {saving ? 'Saving…' : isEditing ? 'Save Changes' : 'Add Vehicle'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
