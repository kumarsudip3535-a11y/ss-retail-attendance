import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { getAllEmployees, setEmployeeDisabled } from '@/services/employeeService'
import type { Employee } from '@/types'
import DashboardHeader from '@/components/DashboardHeader'
import AdminNavTabs from '@/components/AdminNavTabs'
import EmployeeFormModal from '@/components/EmployeeFormModal'
import ConfirmDialog from '@/components/ConfirmDialog'
import { Skeleton } from '@/components/Skeleton'

export default function EmployeeManagementPage() {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editingEmployee, setEditingEmployee] = useState<Employee | undefined>(
    undefined
  )
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [pendingDisable, setPendingDisable] = useState<Employee | null>(null)

  function loadEmployees() {
    setLoading(true)
    setError(null)
    getAllEmployees()
      .then(setEmployees)
      .catch((err) => {
        console.error('[EmployeeManagementPage] Failed to load employees:', err)
        setError('Something went wrong loading employees.')
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    loadEmployees()
  }, [])

  function openAddForm() {
    setEditingEmployee(undefined)
    setShowForm(true)
  }

  function openEditForm(employee: Employee) {
    setEditingEmployee(employee)
    setShowForm(true)
  }

  async function performToggleDisabled(employee: Employee) {
    setTogglingId(employee.id)
    try {
      await setEmployeeDisabled(employee.id, !employee.disabled)
      toast.success(
        employee.disabled ? 'Employee enabled.' : 'Employee disabled.'
      )
      loadEmployees()
    } catch (err) {
      console.error('[EmployeeManagementPage] Toggle failed:', err)
      toast.error('Something went wrong. Please try again.')
    } finally {
      setTogglingId(null)
    }
  }

  function handleToggleDisabled(employee: Employee) {
    if (employee.disabled) {
      // Re-enabling isn't destructive — no confirmation needed.
      performToggleDisabled(employee)
    } else {
      setPendingDisable(employee)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <DashboardHeader />
      <AdminNavTabs />

      <main className="max-w-5xl mx-auto px-4 sm:px-6 pt-6 pb-24 sm:pb-6">
        <div className="rounded-2xl bg-white shadow-sm border border-slate-200 p-6">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold text-slate-800">
              Employees
            </h1>
            <button
              onClick={openAddForm}
              className="rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2"
            >
              + Add Employee
            </button>
          </div>

          <div className="mt-4">
            {loading && (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="flex items-center gap-3 rounded-lg border border-slate-200 p-3"
                  >
                    <Skeleton className="h-10 w-10 rounded-full shrink-0" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-3.5 w-32" />
                      <Skeleton className="h-3 w-48" />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {!loading && error && (
              <p className="text-sm text-red-600 text-center py-8">{error}</p>
            )}

            {!loading && !error && employees.length === 0 && (
              <p className="text-sm text-slate-400 text-center py-8">
                No employees yet. Add your first one above.
              </p>
            )}

            {!loading && !error && employees.length > 0 && (
              <div className="space-y-2">
                {employees.map((emp) => (
                  <div
                    key={emp.id}
                    className="flex items-center justify-between rounded-lg border border-slate-200 p-3"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {emp.photoUrl ? (
                        <img
                          src={emp.photoUrl}
                          alt={emp.name}
                          className="h-10 w-10 rounded-full object-cover border border-slate-200 shrink-0"
                        />
                      ) : (
                        <div className="h-10 w-10 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-sm font-semibold shrink-0">
                          {emp.name.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate">
                          {emp.name}{' '}
                          {emp.disabled && (
                            <span className="text-xs font-normal text-red-500">
                              (disabled)
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-slate-400 truncate">
                          {emp.employeeId} · {emp.phone} ·{' '}
                          {emp.role === 'admin' ? 'Admin' : 'Employee'}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0 ml-3">
                      <button
                        onClick={() => openEditForm(emp)}
                        className="text-xs font-medium text-brand-600 hover:text-brand-700"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleToggleDisabled(emp)}
                        disabled={togglingId === emp.id}
                        className={`text-xs font-medium disabled:opacity-50 ${
                          emp.disabled
                            ? 'text-emerald-600 hover:text-emerald-700'
                            : 'text-red-500 hover:text-red-600'
                        }`}
                      >
                        {togglingId === emp.id
                          ? '…'
                          : emp.disabled
                            ? 'Enable'
                            : 'Disable'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>

      {pendingDisable && (
        <ConfirmDialog
          title="Disable this employee?"
          message={`${pendingDisable.name} won't be able to log in or punch attendance until re-enabled. Their existing records are kept.`}
          confirmLabel="Disable"
          danger
          onConfirm={() => {
            performToggleDisabled(pendingDisable)
            setPendingDisable(null)
          }}
          onCancel={() => setPendingDisable(null)}
        />
      )}

      {showForm && (
        <EmployeeFormModal
          employee={editingEmployee}
          onClose={() => setShowForm(false)}
          onSaved={loadEmployees}
        />
      )}
    </div>
  )
}
