import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  where,
  writeBatch,
} from 'firebase/firestore'
import { getFirebaseDb } from '@/services/firebase'
import type { Advance, AdvanceFormInput, PayrollRecord } from '@/types'

const ADVANCES_COLLECTION = 'advances'
const PAYROLL_COLLECTION = 'payrollRecords'

function docToAdvance(id: string, data: Record<string, unknown>): Advance {
  return {
    id,
    employeeId: data.employeeId as string,
    amount: data.amount as number,
    date: data.date as Timestamp,
    reason: (data.reason as string | null) ?? null,
    repaymentType: data.repaymentType as Advance['repaymentType'],
    emiMonths: (data.emiMonths as number | null) ?? null,
    monthlyDeduction: data.monthlyDeduction as number,
    remainingBalance: data.remainingBalance as number,
    status: data.status as Advance['status'],
    createdBy: data.createdBy as string,
    createdAt: data.createdAt as Timestamp,
  }
}

function payrollDocId(employeeId: string, period: string): string {
  return `${employeeId}_${period}`
}

/**
 * Records a new cash advance. monthlyDeduction is computed here rather
 * than trusted from the caller, so it's never possible to save an advance
 * whose per-cycle figure doesn't actually match its own amount/emiMonths —
 * lump_sum deducts the full amount in one cycle; emi splits it evenly,
 * rounded up to the nearest paisa so `emiMonths` cycles are always enough
 * to fully repay it (the last cycle just deducts less, since every
 * deduction is capped at whatever's actually left — see
 * computePayrollPreview below).
 */
export async function giveAdvance(input: AdvanceFormInput): Promise<string> {
  const db = getFirebaseDb()
  const monthlyDeduction =
    input.repaymentType === 'lump_sum'
      ? input.amount
      : Math.ceil((input.amount / (input.emiMonths || 1)) * 100) / 100

  const docRef = await addDoc(collection(db, ADVANCES_COLLECTION), {
    employeeId: input.employeeId,
    amount: input.amount,
    date: input.date,
    reason: input.reason,
    repaymentType: input.repaymentType,
    emiMonths: input.emiMonths,
    monthlyDeduction,
    remainingBalance: input.amount,
    status: 'outstanding',
    createdBy: input.createdBy,
    createdAt: serverTimestamp(),
  })
  return docRef.id
}

/**
 * Every advance ever given to an employee, oldest first — used both for
 * the advance-history view and (filtered to status === 'outstanding') for
 * payroll computation. A single composite index (employeeId + date) backs
 * this; see firestore.indexes.json.
 */
export async function getAdvancesForEmployee(employeeId: string): Promise<Advance[]> {
  const db = getFirebaseDb()
  const q = query(
    collection(db, ADVANCES_COLLECTION),
    where('employeeId', '==', employeeId),
    orderBy('date', 'asc')
  )
  const snapshot = await getDocs(q)
  return snapshot.docs.map((d) => docToAdvance(d.id, d.data()))
}

export interface PayrollPreview {
  employeeId: string
  period: string
  baseSalary: number
  deductions: { advanceId: string; amount: number }[]
  totalAdvanceDeducted: number
  netPayable: number
  /** Amount that would have been deducted this cycle but exceeded salary — rolls forward automatically next month since it's still sitting in remainingBalance. */
  carryOver: number
}

/**
 * Computes what an employee's payroll for a period WOULD look like,
 * without writing anything — the Payroll page's live preview before
 * "Mark Paid" is clicked. Each outstanding advance is due for
 * min(monthlyDeduction, remainingBalance) this cycle (handles the final,
 * possibly-smaller installment); advances are applied oldest-first, and
 * the running total is capped at baseSalary so Net Payable never goes
 * negative — whatever a cap leaves undeducted simply stays in that
 * advance's remainingBalance and is due again next cycle.
 */
export function computePayrollPreview(
  employeeId: string,
  period: string,
  baseSalary: number,
  outstandingAdvancesOldestFirst: Advance[]
): PayrollPreview {
  const deductions: { advanceId: string; amount: number }[] = []
  let remainingSalary = baseSalary
  let totalAdvanceDeducted = 0
  let carryOver = 0

  for (const advance of outstandingAdvancesOldestFirst) {
    const due = Math.min(advance.monthlyDeduction, advance.remainingBalance)
    const deductible = Math.round(Math.min(due, remainingSalary) * 100) / 100
    if (deductible > 0) {
      deductions.push({ advanceId: advance.id, amount: deductible })
      totalAdvanceDeducted += deductible
      remainingSalary -= deductible
    }
    carryOver += Math.round((due - deductible) * 100) / 100
  }

  return {
    employeeId,
    period,
    baseSalary,
    deductions,
    totalAdvanceDeducted: Math.round(totalAdvanceDeducted * 100) / 100,
    netPayable: Math.round((baseSalary - totalAdvanceDeducted) * 100) / 100,
    carryOver,
  }
}

/** Direct get() by the deterministic `${employeeId}_${period}` doc ID — never a query. */
export async function getPayrollRecord(employeeId: string, period: string): Promise<PayrollRecord | null> {
  const db = getFirebaseDb()
  const snap = await getDoc(doc(db, PAYROLL_COLLECTION, payrollDocId(employeeId, period)))
  if (!snap.exists()) return null
  const data = snap.data()
  return {
    id: snap.id,
    employeeId: data.employeeId as string,
    period: data.period as string,
    baseSalary: data.baseSalary as number,
    advanceDeductions: (data.advanceDeductions as { advanceId: string; amount: number }[]) ?? [],
    totalAdvanceDeducted: (data.totalAdvanceDeducted as number) ?? 0,
    netPayable: data.netPayable as number,
    status: data.status as PayrollRecord['status'],
    paidAt: (data.paidAt as Timestamp | null) ?? null,
    paidBy: (data.paidBy as string | null) ?? null,
    createdAt: data.createdAt as Timestamp,
  }
}

/**
 * Finalizes a period's payroll for one employee: writes the PayrollRecord
 * (status 'paid') and decrements each deducted advance's remainingBalance,
 * marking any advance that hits zero as 'settled'. A batched write, so the
 * record and every advance update land together — a half-applied payroll
 * (record written but balances untouched, or vice versa) would corrupt
 * the ledger.
 */
export async function markPayrollPaid(
  preview: PayrollPreview,
  paidBy: string,
  advancesById: Map<string, Advance>
): Promise<void> {
  const db = getFirebaseDb()
  const batch = writeBatch(db)

  const recordRef = doc(db, PAYROLL_COLLECTION, payrollDocId(preview.employeeId, preview.period))
  batch.set(recordRef, {
    employeeId: preview.employeeId,
    period: preview.period,
    baseSalary: preview.baseSalary,
    advanceDeductions: preview.deductions,
    totalAdvanceDeducted: preview.totalAdvanceDeducted,
    netPayable: preview.netPayable,
    status: 'paid',
    paidAt: serverTimestamp(),
    paidBy,
    createdAt: serverTimestamp(),
  })

  for (const { advanceId, amount } of preview.deductions) {
    const advance = advancesById.get(advanceId)
    if (!advance) continue
    const newBalance = Math.round((advance.remainingBalance - amount) * 100) / 100
    batch.update(doc(db, ADVANCES_COLLECTION, advanceId), {
      remainingBalance: newBalance,
      status: newBalance <= 0 ? 'settled' : 'outstanding',
    })
  }

  await batch.commit()
}
