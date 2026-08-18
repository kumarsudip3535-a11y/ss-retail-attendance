import type { Timestamp } from 'firebase/firestore'

/**
 * Mirrors the `attendanceLogs` collection exactly as stored in Firestore.
 * loginTime/logoutTime are Firestore Timestamps on the wire; logout fields
 * are null until the employee punches out.
 */
export interface AttendanceLog {
  /** Firestore document ID */
  id: string
  employeeId: string
  loginTime: Timestamp
  loginLat: number
  loginLng: number
  logoutTime: Timestamp | null
  logoutLat: number | null
  logoutLng: number | null
  totalHours: number | null
  overtimeHours: number | null
}

/** Status derived from an AttendanceLog for display purposes (not stored). */
export type AttendanceStatus = 'active' | 'completed'

export function getAttendanceStatus(log: AttendanceLog): AttendanceStatus {
  return log.logoutTime ? 'completed' : 'active'
}
