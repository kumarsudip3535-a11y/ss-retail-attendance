import { useState } from 'react'
import toast from 'react-hot-toast'
import { createEmployee, updateEmployee } from '@/services/employeeService'
import { uploadEmployeePhoto } from '@/services/storageService'
import { toE164IndianPhone } from '@/services/authService'
import type { Employee, ReimbursementMethod, UserRole } from '@/types'

interface EmployeeFormModalProps {
  /** Present when editing; undefined when creating a new employee. */
  employee?: Employee
  onClose: () => void
  onSaved: () => void
}

const REIMBURSEMENT_METHOD_CHOICES: { value: ReimbursementMethod; label: string }[] = [
  { value: 'fuel_mileage', label: 'Fuel + Mileage' },
  { value: 'per_km', label: 'Per KM (flat)' },
  { value: 'custom_vehicle_rate', label: "Vehicle's Rate" },
  { value: 'manual', label: 'Manual' },
]

function stripCountryCode(phone: string): string {
  return phone.replace(/^\+91/, '')
}

export default function EmployeeFormModal({
  employee,
  onClose,
  onSaved,
}: EmployeeFormModalProps) {
  const isEditing = !!employee

  const [name, setName] = useState(employee?.name ?? '')
  const [employeeId, setEmployeeId] = useState(employee?.employeeId ?? '')
  const [phone, setPhone] = useState(
    employee ? stripCountryCode(employee.phone) : ''
  )
  const [officeLat, setOfficeLat] = useState(
    employee ? String(employee.officeLat) : ''
  )
  const [officeLng, setOfficeLng] = useState(
    employee ? String(employee.officeLng) : ''
  )
  const [geofenceRadius, setGeofenceRadius] = useState(
    employee ? String(employee.geofenceRadius) : '100'
  )
  const [role, setRole] = useState<UserRole>(employee?.role ?? 'employee')
  const [allowedReimbursementMethods, setAllowedReimbursementMethods] = useState<
    ReimbursementMethod[]
  >(employee?.allowedReimbursementMethods ?? ['fuel_mileage'])
  const [baseSalary, setBaseSalary] = useState(
    employee ? String(employee.baseSalary) : '0'
  )
  // Phase T14: defaults to true for a brand-new employee, matching
  // DEFAULT_TRACKING_ENABLED in employeeService.ts/authService.ts — an
  // admin piloting the module holds specific people back by unchecking
  // this, rather than starting everyone off and opting a few in.
  const [trackingEnabled, setTrackingEnabled] = useState(
    employee?.trackingEnabled ?? true
  )
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(
    employee?.photoUrl || null
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setPhotoFile(file)
    setPhotoPreview(URL.createObjectURL(file))
  }

  function toggleReimbursementMethod(method: ReimbursementMethod) {
    setAllowedReimbursementMethods((prev) =>
      prev.includes(method) ? prev.filter((m) => m !== method) : [...prev, method]
    )
  }

  function validate(): string | null {
    if (!name.trim()) return 'Name is required.'
    if (!employeeId.trim()) return 'Employee ID is required.'
    if (phone.replace(/\D/g, '').length < 10)
      return 'Enter a valid 10-digit mobile number.'
    const lat = parseFloat(officeLat)
    const lng = parseFloat(officeLng)
    if (!Number.isFinite(lat) || lat < -90 || lat > 90)
      return 'Office latitude must be a number between -90 and 90.'
    if (!Number.isFinite(lng) || lng < -180 || lng > 180)
      return 'Office longitude must be a number between -180 and 180.'
    const radius = parseFloat(geofenceRadius)
    if (!Number.isFinite(radius) || radius <= 0)
      return 'Geofence radius must be a positive number.'
    if (allowedReimbursementMethods.length === 0)
      return 'Select at least one reimbursement method for this employee.'
    const salary = parseFloat(baseSalary)
    if (!Number.isFinite(salary) || salary < 0)
      return 'Base salary must be a non-negative number.'
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
      const fullPhone = toE164IndianPhone(phone)
      const baseData = {
        name: name.trim(),
        employeeId: employeeId.trim(),
        phone: fullPhone,
        officeLat: parseFloat(officeLat),
        officeLng: parseFloat(officeLng),
        geofenceRadius: parseFloat(geofenceRadius),
        role,
        allowedReimbursementMethods,
        baseSalary: parseFloat(baseSalary),
        trackingEnabled,
      }

      if (isEditing) {
        let photoUrl = employee.photoUrl
        if (photoFile) {
          photoUrl = await uploadEmployeePhoto(employee.employeeId, photoFile)
        }
        await updateEmployee(employee.id, { ...baseData, photoUrl })
        toast.success('Employee updated.')
      } else {
        // Upload photo (if any) under the employeeId, then create the doc.
        let photoUrl = ''
        if (photoFile) {
          photoUrl = await uploadEmployeePhoto(
            baseData.employeeId,
            photoFile
          )
        }
        await createEmployee({ ...baseData, photoUrl, disabled: false, assignedVehicleId: null })
        toast.success('Employee added.')
      }

      onSaved()
      onClose()
    } catch (err) {
      console.error('[EmployeeFormModal] Save failed:', err)
      setError('Something went wrong. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center px-4 py-8 overflow-y-auto">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-lg p-6">
        <h2 className="text-lg font-semibold text-slate-800">
          {isEditing ? 'Edit Employee' : 'Add Employee'}
        </h2>

        {error && (
          <div className="mt-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div className="flex items-center gap-4">
            {photoPreview ? (
              <img
                src={photoPreview}
                alt="Preview"
                className="h-14 w-14 rounded-full object-cover border border-slate-200"
              />
            ) : (
              <div className="h-14 w-14 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 text-xs">
                Photo
              </div>
            )}
            <label className="text-xs text-brand-600 hover:text-brand-700 cursor-pointer font-medium">
              {photoPreview ? 'Change photo' : 'Upload photo'}
              <input
                type="file"
                accept="image/*"
                onChange={handlePhotoChange}
                className="hidden"
              />
            </label>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Name
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Employee ID
            </label>
            <input
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Mobile Number
            </label>
            <div className="flex rounded-lg border border-slate-300 overflow-hidden focus-within:ring-2 focus-within:ring-brand-500">
              <span className="px-3 py-2 bg-slate-50 text-slate-500 text-sm border-r border-slate-300">
                +91
              </span>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                maxLength={10}
                inputMode="numeric"
                className="flex-1 px-3 py-2 text-sm outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Office Latitude
              </label>
              <input
                value={officeLat}
                onChange={(e) => setOfficeLat(e.target.value)}
                inputMode="decimal"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Office Longitude
              </label>
              <input
                value={officeLng}
                onChange={(e) => setOfficeLng(e.target.value)}
                inputMode="decimal"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Geofence Radius (meters)
            </label>
            <input
              value={geofenceRadius}
              onChange={(e) => setGeofenceRadius(e.target.value)}
              inputMode="numeric"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Role
            </label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as UserRole)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="employee">Employee</option>
              <option value="admin">Admin</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Base Salary (₹ / month)
            </label>
            <input
              value={baseSalary}
              onChange={(e) => setBaseSalary(e.target.value)}
              inputMode="decimal"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500"
            />
            <p className="mt-1 text-xs text-slate-400">
              Used on the Payroll page to compute Net Payable after advance deductions. Travel reimbursement is separate and never affects this.
            </p>
          </div>

          <div>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={trackingEnabled}
                onChange={(e) => setTrackingEnabled(e.target.checked)}
              />
              Live Tracking enabled (Phase T14)
            </label>
            <p className="mt-1 text-xs text-slate-400">
              Controls the whole Live Tracking / Route Replay / Travel Expense
              module for this employee — for a staged pilot rollout. When off,
              Punch In records attendance as normal but doesn't start GPS
              tracking. Attendance itself is never affected either way.
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Reimbursement methods (Phase T8)
            </label>
            <p className="text-xs text-slate-400 mb-2">
              Which methods this employee may choose from when claiming travel
              expense for their own routes. Admins are never restricted by
              this — it only applies to the employee's own view.
            </p>
            <div className="space-y-1.5">
              {REIMBURSEMENT_METHOD_CHOICES.map((choice) => (
                <label
                  key={choice.value}
                  className="flex items-center gap-2 text-sm text-slate-700"
                >
                  <input
                    type="checkbox"
                    checked={allowedReimbursementMethods.includes(choice.value)}
                    onChange={() => toggleReimbursementMethod(choice.value)}
                  />
                  {choice.label}
                </label>
              ))}
            </div>
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
              {saving ? 'Saving…' : isEditing ? 'Save Changes' : 'Add Employee'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
