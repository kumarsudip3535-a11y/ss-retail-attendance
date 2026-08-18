import type { ReimbursementMethod } from './travelClaim'

export type UserRole = 'employee' | 'admin'

export interface Employee {
  /** Firestore document ID */
  id: string
  name: string
  employeeId: string
  /** E.164 format, e.g. +919905719715 */
  phone: string
  officeLat: number
  officeLng: number
  /** Allowed distance from office, in meters */
  geofenceRadius: number
  role: UserRole
  photoUrl: string
  /** Soft-delete flag; disabled employees cannot log in */
  disabled?: boolean
  /** Optional link to a Vehicle Master record (Live Tracking module) */
  assignedVehicleId?: string | null
  /**
   * Phase T8: which reimbursement methods this employee may pick for
   * their own travel claims on Route Replay — admin-configurable per
   * employee. An admin viewing any employee's route is never restricted
   * by this list (it only gates the employee's own view of their own
   * route), so this exists purely to keep employee-facing choices
   * intentional rather than to enforce a security boundary. Defaults to
   * `['fuel_mileage']` for any employee where it hasn't been explicitly
   * set (see employeeService.ts).
   */
  allowedReimbursementMethods: ReimbursementMethod[]
  /**
   * Phase T10: fixed monthly gross salary, ₹ — the base figure Net Payable
   * is computed from on the Payroll page. Defaults to 0 for any employee
   * record saved before this phase, until an admin sets it explicitly.
   */
  baseSalary: number
  /**
   * Phase T14: per-employee kill switch for the whole Live Tracking /
   * Route Replay / Travel Expense module — what makes a staged pilot
   * rollout to a subset of field employees possible, rather than an
   * all-or-nothing switch. Defaults to `true` for any employee record
   * saved before this phase (see employeeService.ts/authService.ts), so
   * shipping this field doesn't silently turn tracking off for anyone
   * already relying on it — an admin opts specific employees OUT, rather
   * than opting a pilot group IN from a default-off state. When false,
   * Punch In simply never starts a new tracking session for that
   * employee (attendance itself is completely unaffected); Route
   * Replay/Travel Claim already handle "no tracking data for this shift"
   * gracefully, per ReplayLink/ClaimLink's doc comments in
   * AttendanceHistoryPage.tsx.
   */
  trackingEnabled: boolean
}

/** Shape used when creating/editing an employee from the admin UI (no id yet) */
export type EmployeeFormInput = Omit<Employee, 'id'>
