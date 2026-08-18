import type { Timestamp } from 'firebase/firestore'

/**
 * Phase T10: employee cash advances & monthly payroll.
 *
 * Deliberately kept entirely separate from `travelClaim.ts` — the user was
 * explicit that travel reimbursement is paid separately and should never
 * net against salary/advances. This file models only the salary side.
 */

export type RepaymentType = 'lump_sum' | 'emi'

/**
 * One cash advance given to an employee. Repayment is either the full
 * amount in a single payroll cycle ('lump_sum'), or split evenly across a
 * fixed number of months ('emi') — `monthlyDeduction` is the amount due
 * each cycle either way (the whole `amount` for lump_sum, `amount /
 * emiMonths` rounded for emi). `remainingBalance` starts equal to `amount`
 * and is decremented every time a payroll run actually deducts against it
 * (see payrollService.ts's markPayrollPaid) — it is the source of truth for
 * how much is still owed, not a value computed from elapsed months, since
 * a payroll run can be skipped or short-paid.
 */
export interface Advance {
  id: string
  employeeId: string
  amount: number
  date: Timestamp
  reason: string | null
  repaymentType: RepaymentType
  /** Set only when repaymentType === 'emi'; null for lump_sum. */
  emiMonths: number | null
  monthlyDeduction: number
  remainingBalance: number
  status: 'outstanding' | 'settled'
  createdBy: string
  createdAt: Timestamp
}

export type AdvanceFormInput = Omit<
  Advance,
  'id' | 'monthlyDeduction' | 'remainingBalance' | 'status' | 'createdAt'
>

export type PayrollStatus = 'pending' | 'paid'

/**
 * One employee's payroll for one calendar month. Document ID is
 * `${employeeId}_${period}` (period = "YYYY-MM") so there can only ever be
 * one record per employee per month — same "doc ID as the natural key"
 * pattern travelClaims uses (Phase T9) to keep every lookup a direct
 * get() rather than a query.
 *
 * `baseSalary` and the advance breakdown are snapshotted at the moment the
 * record is created/updated — if an employee's salary changes next month,
 * this month's already-recorded figure doesn't silently change with it.
 */
export interface PayrollRecord {
  id: string
  employeeId: string
  /** "YYYY-MM" */
  period: string
  baseSalary: number
  advanceDeductions: { advanceId: string; amount: number }[]
  totalAdvanceDeducted: number
  netPayable: number
  status: PayrollStatus
  paidAt: Timestamp | null
  paidBy: string | null
  createdAt: Timestamp
}
