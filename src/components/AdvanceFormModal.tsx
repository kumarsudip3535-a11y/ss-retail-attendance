import { useState } from 'react'
import toast from 'react-hot-toast'
import { Timestamp } from 'firebase/firestore'
import { useAuth } from '@/context/AuthContext'
import { giveAdvance } from '@/services/payrollService'
import type { Employee, RepaymentType } from '@/types'

interface AdvanceFormModalProps {
  employees: Employee[]
  /** Pre-selects the employee when opened from that employee's own advance history. */
  defaultEmployeeId?: string
  onClose: () => void
  onSaved: () => void
}

function toDateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export default function AdvanceFormModal({
  employees,
  defaultEmployeeId,
  onClose,
  onSaved,
}: AdvanceFormModalProps) {
  const { employee: viewer } = useAuth()
  const [employeeId, setEmployeeId] = useState(defaultEmployeeId ?? employees[0]?.id ?? '')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(toDateInputValue(new Date()))
  const [reason, setReason] = useState('')
  const [repaymentType, setRepaymentType] = useState<RepaymentType>('lump_sum')
  const [emiMonths, setEmiMonths] = useState('2')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const parsedAmount = parseFloat(amount)
  const parsedEmiMonths = parseInt(emiMonths, 10)
  const previewMonthlyDeduction =
    repaymentType === 'lump_sum'
      ? Number.isFinite(parsedAmount)
        ? parsedAmount
        : null
      : Number.isFinite(parsedAmount) && parsedEmiMonths > 0
        ? Math.ceil((parsedAmount / parsedEmiMonths) * 100) / 100
        : null

  function validate(): string | null {
    if (!employeeId) return 'Select an employee.'
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) return 'Amount must be a positive number.'
    if (!date) return 'Date is required.'
    if (repaymentType === 'emi' && (!Number.isInteger(parsedEmiMonths) || parsedEmiMonths < 1)) {
      return 'EMI months must be a whole number of 1 or more.'
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
    if (!viewer) return

    setError(null)
    setSaving(true)
    try {
      await giveAdvance({
        employeeId,
        amount: parsedAmount,
        date: Timestamp.fromDate(new Date(`${date}T00:00:00`)),
        reason: reason.trim() || null,
        repaymentType,
        emiMonths: repaymentType === 'emi' ? parsedEmiMonths : null,
        createdBy: viewer.id,
      })
      toast.success('Advance recorded.')
      onSaved()
      onClose()
    } catch (err) {
      console.error('[AdvanceFormModal] Save failed:', err)
      setError('Something went wrong. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center px-4 py-8 overflow-y-auto">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-lg p-6">
        <h2 className="text-lg font-semibold text-slate-800">Give Advance</h2>
        <p className="mt-1 text-xs text-slate-400">
          Recorded separately from travel reimbursement — this only affects the Payroll page's salary math.
        </p>

        {error && (
          <div className="mt-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Employee</label>
            <select
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              disabled={!!defaultEmployeeId}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-slate-50 disabled:text-slate-500"
            >
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.name} ({emp.employeeId})
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Amount (₹)</label>
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Date</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Reason <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Medical, personal"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Repayment</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setRepaymentType('lump_sum')}
                className={`flex-1 rounded-lg text-xs font-medium py-2 transition-colors ${
                  repaymentType === 'lump_sum'
                    ? 'bg-brand-600 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                Deduct all at once
              </button>
              <button
                type="button"
                onClick={() => setRepaymentType('emi')}
                className={`flex-1 rounded-lg text-xs font-medium py-2 transition-colors ${
                  repaymentType === 'emi'
                    ? 'bg-brand-600 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                Split into EMIs
              </button>
            </div>
          </div>

          {repaymentType === 'emi' && (
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Number of months</label>
              <input
                value={emiMonths}
                onChange={(e) => setEmiMonths(e.target.value)}
                inputMode="numeric"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
          )}

          {previewMonthlyDeduction !== null && (
            <p className="text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2">
              {repaymentType === 'lump_sum'
                ? `Full ₹${previewMonthlyDeduction.toFixed(2)} will be deducted from next payroll (or spread further if salary that month is too low).`
                : `~₹${previewMonthlyDeduction.toFixed(2)} will be deducted each month for up to ${emiMonths} month(s).`}
            </p>
          )}

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
              {saving ? 'Saving…' : 'Give Advance'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
