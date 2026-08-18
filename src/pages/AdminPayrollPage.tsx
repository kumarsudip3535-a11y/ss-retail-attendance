import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { useAuth } from '@/context/AuthContext'
import { getAllEmployees } from '@/services/employeeService'
import {
  computePayrollPreview,
  getAdvancesForEmployee,
  getPayrollRecord,
  markPayrollPaid,
  type PayrollPreview,
} from '@/services/payrollService'
import type { Advance, Employee, PayrollRecord } from '@/types'
import DashboardHeader from '@/components/DashboardHeader'
import AdminNavTabs from '@/components/AdminNavTabs'
import AdvanceFormModal from '@/components/AdvanceFormModal'
import AdvanceHistoryModal from '@/components/AdvanceHistoryModal'
import { TableRowSkeleton } from '@/components/Skeleton'

function toMonthInputValue(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

interface EmployeeRow {
  employee: Employee
  advances: Advance[]
  record: PayrollRecord | null
  preview: PayrollPreview
}

export default function AdminPayrollPage() {
  const { employee: viewer } = useAuth()

  const [period, setPeriod] = useState(toMonthInputValue(new Date()))
  const [rows, setRows] = useState<EmployeeRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [payingId, setPayingId] = useState<string | null>(null)

  const [showAdvanceModal, setShowAdvanceModal] = useState(false)
  const [advanceModalEmployeeId, setAdvanceModalEmployeeId] = useState<string | undefined>(undefined)
  const [historyEmployeeId, setHistoryEmployeeId] = useState<string | null>(null)

  function loadData() {
    let cancelled = false
    setLoading(true)
    setError(null)

    getAllEmployees()
      .then(async (employees) => {
        const activeEmployees = employees.filter((e) => !e.disabled)
        const results = await Promise.all(
          activeEmployees.map(async (employee) => {
            const [advances, record] = await Promise.all([
              getAdvancesForEmployee(employee.id),
              getPayrollRecord(employee.id, period),
            ])
            const outstanding = advances.filter((a) => a.status === 'outstanding')
            const preview = computePayrollPreview(employee.id, period, employee.baseSalary, outstanding)
            return { employee, advances, record, preview }
          })
        )
        if (!cancelled) setRows(results)
      })
      .catch((err) => {
        console.error('[AdminPayrollPage] Failed to load payroll data:', err)
        if (!cancelled) setError('Something went wrong loading payroll data.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }

  useEffect(loadData, [period])

  async function handleMarkPaid(row: EmployeeRow) {
    if (!viewer) return
    if (row.preview.baseSalary <= 0) {
      toast.error(`${row.employee.name} has no base salary set — add one in Employee Management first.`)
      return
    }
    setPayingId(row.employee.id)
    try {
      const advancesById = new Map(row.advances.map((a) => [a.id, a]))
      await markPayrollPaid(row.preview, viewer.id, advancesById)
      toast.success(`${row.employee.name}'s payroll for ${period} marked paid.`)
      loadData()
    } catch (err) {
      console.error('[AdminPayrollPage] Mark paid failed:', err)
      toast.error('Could not mark as paid. Please try again.')
    } finally {
      setPayingId(null)
    }
  }

  const historyRow = rows.find((r) => r.employee.id === historyEmployeeId) ?? null

  return (
    <div className="min-h-screen bg-slate-50">
      <DashboardHeader />
      <AdminNavTabs />

      <main className="max-w-5xl mx-auto px-4 sm:px-6 pt-6 pb-24 sm:pb-6 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-slate-800">Payroll</h1>
            <p className="text-sm text-slate-400">
              Base salary minus outstanding advances. Travel reimbursement is separate and never affects this.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="month"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            />
            <button
              onClick={() => {
                setAdvanceModalEmployeeId(undefined)
                setShowAdvanceModal(true)
              }}
              className="rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2"
            >
              + Give Advance
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-600">{error}</div>
        )}

        <div className="rounded-2xl bg-white shadow-sm border border-slate-200 p-6">
          {loading && (
            <table className="w-full text-sm">
              <tbody>
                <TableRowSkeleton columns={6} />
                <TableRowSkeleton columns={6} />
                <TableRowSkeleton columns={6} />
              </tbody>
            </table>
          )}

          {!loading && !error && rows.length === 0 && (
            <p className="text-sm text-slate-400 text-center py-8">No active employees.</p>
          )}

          {!loading && !error && rows.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400 border-b border-slate-200">
                  <th className="pb-2 font-medium">Employee</th>
                  <th className="pb-2 font-medium">Base Salary</th>
                  <th className="pb-2 font-medium">Advance Due</th>
                  <th className="pb-2 font-medium">Net Payable</th>
                  <th className="pb-2 font-medium">Status</th>
                  <th className="pb-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const status = row.record?.status ?? 'pending'
                  const baseSalary = row.record?.baseSalary ?? row.preview.baseSalary
                  const advanceDue = row.record?.totalAdvanceDeducted ?? row.preview.totalAdvanceDeducted
                  const netPayable = row.record?.netPayable ?? row.preview.netPayable

                  return (
                    <tr key={row.employee.id} className="border-b border-slate-100 last:border-0">
                      <td className="py-2.5">
                        <p className="text-slate-800 font-medium">{row.employee.name}</p>
                        <p className="text-xs text-slate-400">{row.employee.employeeId}</p>
                      </td>
                      <td className="py-2.5 text-slate-700">₹{baseSalary.toFixed(2)}</td>
                      <td className="py-2.5 text-slate-700">₹{advanceDue.toFixed(2)}</td>
                      <td className="py-2.5 text-slate-800 font-medium">₹{netPayable.toFixed(2)}</td>
                      <td className="py-2.5">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                            status === 'paid' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {status === 'paid' ? 'Paid' : 'Pending'}
                        </span>
                      </td>
                      <td className="py-2.5 text-right space-x-3 whitespace-nowrap">
                        <button
                          onClick={() => setHistoryEmployeeId(row.employee.id)}
                          className="text-xs font-medium text-brand-700 hover:underline"
                        >
                          Advances
                        </button>
                        {status === 'pending' && (
                          <button
                            onClick={() => handleMarkPaid(row)}
                            disabled={payingId === row.employee.id}
                            className="text-xs font-medium text-emerald-700 hover:underline disabled:opacity-50"
                          >
                            {payingId === row.employee.id ? 'Marking…' : 'Mark Paid'}
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </main>

      {showAdvanceModal && (
        <AdvanceFormModal
          employees={rows.map((r) => r.employee)}
          defaultEmployeeId={advanceModalEmployeeId}
          onClose={() => setShowAdvanceModal(false)}
          onSaved={loadData}
        />
      )}

      {historyRow && (
        <AdvanceHistoryModal
          employee={historyRow.employee}
          advances={historyRow.advances}
          onClose={() => setHistoryEmployeeId(null)}
          onGiveAdvance={() => {
            setAdvanceModalEmployeeId(historyRow.employee.id)
            setHistoryEmployeeId(null)
            setShowAdvanceModal(true)
          }}
        />
      )}
    </div>
  )
}
