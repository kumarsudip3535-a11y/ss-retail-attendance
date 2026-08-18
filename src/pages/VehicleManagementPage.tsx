import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { getAllEmployees } from '@/services/employeeService'
import {
  getAllFuelRates,
  getAllVehicles,
  setFuelRateActive,
  setVehicleActive,
} from '@/services/vehicleService'
import type { Employee, FuelRate, Vehicle } from '@/types'
import { formatDateIST } from '@/hooks/useClock'
import DashboardHeader from '@/components/DashboardHeader'
import AdminNavTabs from '@/components/AdminNavTabs'
import VehicleFormModal from '@/components/VehicleFormModal'
import FuelRateFormModal from '@/components/FuelRateFormModal'
import ConfirmDialog from '@/components/ConfirmDialog'
import { Skeleton } from '@/components/Skeleton'

type SubTab = 'vehicles' | 'fuelRates'

function prettyLabel(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

export default function VehicleManagementPage() {
  const [subTab, setSubTab] = useState<SubTab>('vehicles')

  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [fuelRates, setFuelRates] = useState<FuelRate[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [showVehicleForm, setShowVehicleForm] = useState(false)
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | undefined>(undefined)
  const [togglingVehicleId, setTogglingVehicleId] = useState<string | null>(null)
  const [pendingDeactivateVehicle, setPendingDeactivateVehicle] = useState<Vehicle | null>(null)

  const [showFuelRateForm, setShowFuelRateForm] = useState(false)
  const [togglingFuelRateId, setTogglingFuelRateId] = useState<string | null>(null)
  const [pendingDeactivateFuelRate, setPendingDeactivateFuelRate] = useState<FuelRate | null>(
    null
  )

  function loadAll() {
    setLoading(true)
    setError(null)
    Promise.all([getAllVehicles(), getAllFuelRates(), getAllEmployees()])
      .then(([v, f, e]) => {
        setVehicles(v)
        setFuelRates(f)
        setEmployees(e)
      })
      .catch((err) => {
        console.error('[VehicleManagementPage] Failed to load data:', err)
        setError('Something went wrong loading vehicles and fuel rates.')
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    loadAll()
  }, [])

  const employeeById = useMemo(() => {
    const map = new Map<string, Employee>()
    employees.forEach((e) => map.set(e.id, e))
    return map
  }, [employees])

  function openAddVehicleForm() {
    setEditingVehicle(undefined)
    setShowVehicleForm(true)
  }
  function openEditVehicleForm(vehicle: Vehicle) {
    setEditingVehicle(vehicle)
    setShowVehicleForm(true)
  }

  async function performToggleVehicle(vehicle: Vehicle) {
    setTogglingVehicleId(vehicle.id)
    try {
      await setVehicleActive(vehicle.id, !vehicle.active)
      toast.success(vehicle.active ? 'Vehicle deactivated.' : 'Vehicle activated.')
      loadAll()
    } catch (err) {
      console.error('[VehicleManagementPage] Vehicle toggle failed:', err)
      toast.error('Something went wrong. Please try again.')
    } finally {
      setTogglingVehicleId(null)
    }
  }

  function handleToggleVehicle(vehicle: Vehicle) {
    if (vehicle.active) {
      setPendingDeactivateVehicle(vehicle)
    } else {
      performToggleVehicle(vehicle)
    }
  }

  async function performToggleFuelRate(rate: FuelRate) {
    setTogglingFuelRateId(rate.id)
    try {
      await setFuelRateActive(rate.id, !rate.active)
      toast.success(rate.active ? 'Fuel rate deactivated.' : 'Fuel rate activated.')
      loadAll()
    } catch (err) {
      console.error('[VehicleManagementPage] Fuel rate toggle failed:', err)
      toast.error('Something went wrong. Please try again.')
    } finally {
      setTogglingFuelRateId(null)
    }
  }

  function handleToggleFuelRate(rate: FuelRate) {
    if (rate.active) {
      setPendingDeactivateFuelRate(rate)
    } else {
      performToggleFuelRate(rate)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <DashboardHeader />
      <AdminNavTabs />

      <main className="max-w-5xl mx-auto px-4 sm:px-6 pt-6 pb-24 sm:pb-6">
        <div className="rounded-2xl bg-white shadow-sm border border-slate-200 p-6">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h1 className="text-lg font-semibold text-slate-800">Vehicles</h1>
              <p className="text-sm text-slate-400">Vehicle Master &amp; Fuel Rate Management</p>
            </div>
            <button
              onClick={subTab === 'vehicles' ? openAddVehicleForm : () => setShowFuelRateForm(true)}
              className="rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2"
            >
              {subTab === 'vehicles' ? '+ Add Vehicle' : '+ Add Fuel Rate'}
            </button>
          </div>

          <div className="mt-4 flex gap-2">
            <button
              onClick={() => setSubTab('vehicles')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                subTab === 'vehicles'
                  ? 'bg-brand-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              Vehicles
            </button>
            <button
              onClick={() => setSubTab('fuelRates')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                subTab === 'fuelRates'
                  ? 'bg-brand-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              Fuel Rates
            </button>
          </div>

          <div className="mt-4">
            {loading && (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="rounded-lg border border-slate-200 p-3">
                    <Skeleton className="h-3.5 w-40 mb-2" />
                    <Skeleton className="h-3 w-64" />
                  </div>
                ))}
              </div>
            )}

            {!loading && error && (
              <p className="text-sm text-red-600 text-center py-8">{error}</p>
            )}

            {!loading && !error && subTab === 'vehicles' && (
              <>
                {vehicles.length === 0 ? (
                  <p className="text-sm text-slate-400 text-center py-8">
                    No vehicles yet. Add your first one above.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {vehicles.map((v) => {
                      const assignedEmployee = v.assignedEmployeeId
                        ? employeeById.get(v.assignedEmployeeId)
                        : null
                      return (
                        <div
                          key={v.id}
                          className="flex items-center justify-between rounded-lg border border-slate-200 p-3"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-slate-800 truncate">
                              {v.vehicleNumber}{' '}
                              {!v.active && (
                                <span className="text-xs font-normal text-red-500">
                                  (inactive)
                                </span>
                              )}
                            </p>
                            <p className="text-xs text-slate-400 truncate">
                              {prettyLabel(v.vehicleType)} · {prettyLabel(v.fuelType)} ·{' '}
                              {v.mileage} km/L
                              {v.fuelReimbursementRate != null &&
                                ` · ₹${v.fuelReimbursementRate}/L override`}
                              {v.perKmRate != null && ` · ₹${v.perKmRate}/km override`}
                            </p>
                            <p className="text-xs text-slate-400 truncate">
                              {assignedEmployee
                                ? `Assigned to ${assignedEmployee.name} (${assignedEmployee.employeeId})`
                                : 'Unassigned'}
                            </p>
                          </div>

                          <div className="flex items-center gap-3 shrink-0 ml-3">
                            <button
                              onClick={() => openEditVehicleForm(v)}
                              className="text-xs font-medium text-brand-600 hover:text-brand-700"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleToggleVehicle(v)}
                              disabled={togglingVehicleId === v.id}
                              className={`text-xs font-medium disabled:opacity-50 ${
                                v.active
                                  ? 'text-red-500 hover:text-red-600'
                                  : 'text-emerald-600 hover:text-emerald-700'
                              }`}
                            >
                              {togglingVehicleId === v.id
                                ? '…'
                                : v.active
                                  ? 'Deactivate'
                                  : 'Activate'}
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </>
            )}

            {!loading && !error && subTab === 'fuelRates' && (
              <>
                {fuelRates.length === 0 ? (
                  <p className="text-sm text-slate-400 text-center py-8">
                    No fuel rates yet. Add the first one above.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {fuelRates.map((rate) => (
                      <div
                        key={rate.id}
                        className="flex items-center justify-between rounded-lg border border-slate-200 p-3"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-800 truncate">
                            {prettyLabel(rate.fuelType)} — ₹{rate.ratePerLiter}/L{' '}
                            {!rate.active && (
                              <span className="text-xs font-normal text-red-500">
                                (inactive)
                              </span>
                            )}
                          </p>
                          <p className="text-xs text-slate-400 truncate">
                            Effective {formatDateIST(rate.effectiveDate.toDate())}
                            {rate.location && ` · ${rate.location}`}
                            {rate.source && ` · ${rate.source}`}
                          </p>
                        </div>

                        <div className="shrink-0 ml-3">
                          <button
                            onClick={() => handleToggleFuelRate(rate)}
                            disabled={togglingFuelRateId === rate.id}
                            className={`text-xs font-medium disabled:opacity-50 ${
                              rate.active
                                ? 'text-red-500 hover:text-red-600'
                                : 'text-emerald-600 hover:text-emerald-700'
                            }`}
                          >
                            {togglingFuelRateId === rate.id
                              ? '…'
                              : rate.active
                                ? 'Deactivate'
                                : 'Activate'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </main>

      {pendingDeactivateVehicle && (
        <ConfirmDialog
          title="Deactivate this vehicle?"
          message={`${pendingDeactivateVehicle.vehicleNumber} won't be selectable for new travel expense claims until reactivated. Past claims that reference it are kept.`}
          confirmLabel="Deactivate"
          danger
          onConfirm={() => {
            performToggleVehicle(pendingDeactivateVehicle)
            setPendingDeactivateVehicle(null)
          }}
          onCancel={() => setPendingDeactivateVehicle(null)}
        />
      )}

      {pendingDeactivateFuelRate && (
        <ConfirmDialog
          title="Deactivate this fuel rate?"
          message="It won't be used for any new expense calculations. Claims already computed using it are kept."
          confirmLabel="Deactivate"
          danger
          onConfirm={() => {
            performToggleFuelRate(pendingDeactivateFuelRate)
            setPendingDeactivateFuelRate(null)
          }}
          onCancel={() => setPendingDeactivateFuelRate(null)}
        />
      )}

      {showVehicleForm && (
        <VehicleFormModal
          vehicle={editingVehicle}
          employees={employees}
          onClose={() => setShowVehicleForm(false)}
          onSaved={loadAll}
        />
      )}

      {showFuelRateForm && (
        <FuelRateFormModal onClose={() => setShowFuelRateForm(false)} onSaved={loadAll} />
      )}
    </div>
  )
}
