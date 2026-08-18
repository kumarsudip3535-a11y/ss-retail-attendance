import type { Advance, Employee } from '@/types'
import { formatDateIST } from '@/hooks/useClock'

interface AdvanceHistoryModalProps {
  employee: Employee
  advances: Advance[]
  onClose: () => void
  onGiveAdvance: () => void
}

function StatusPill({ status }: { status: Advance['status'] }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
        status === 'outstanding' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
      }`}
    >
      {status === 'outstanding' ? 'Outstanding' : 'Settled'}
    </span>
  )
}

/** Newest-first for readability, even though the service returns oldest-first for payroll math. */
export default function AdvanceHistoryModal({ employee, advances, onClose, onGiveAdvance }: AdvanceHistoryModalProps) {
  const newestFirst = [...advances].reverse()
  const totalOutstanding = advances
    .filter((a) => a.status === 'outstanding')
    .reduce((sum, a) => sum + a.remainingBalance, 0)

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center px-4 py-8 overflow-y-auto">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-lg p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-800">
              {employee.name}&rsquo;s Advances
            </h2>
            <p className="text-xs text-slate-400">{employee.employeeId}</p>
          </div>
          <button
            onClick={onGiveAdvance}
            className="shrink-0 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-xs font-medium px-3 py-1.5"
          >
            + Give Advance
          </button>
        </div>

        <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">
          Total outstanding: ₹{totalOutstanding.toFixed(2)}
        </div>

        <div className="mt-4 max-h-96 overflow-y-auto space-y-2">
          {newestFirst.length === 0 && (
            <p className="text-sm text-slate-400 text-center py-6">No advances recorded yet.</p>
          )}
          {newestFirst.map((advance) => (
            <div key={advance.id} className="rounded-lg border border-slate-200 p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-slate-800">₹{advance.amount.toFixed(2)}</p>
                <StatusPill status={advance.status} />
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                {formatDateIST(advance.date.toDate())}
                {advance.reason ? ` — ${advance.reason}` : ''}
              </p>
              <p className="text-xs text-slate-500 mt-1">
                {advance.repaymentType === 'lump_sum'
                  ? 'Deduct all at once'
                  : `EMI over ${advance.emiMonths} month(s), ₹${advance.monthlyDeduction.toFixed(2)}/month`}
                {' — '}
                {advance.status === 'outstanding'
                  ? `₹${advance.remainingBalance.toFixed(2)} remaining`
                  : 'fully repaid'}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-4">
          <button
            onClick={onClose}
            className="w-full rounded-lg border border-slate-300 text-slate-700 text-sm font-medium py-2.5 hover:bg-slate-50"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
