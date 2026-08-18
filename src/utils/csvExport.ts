import type { AttendanceLog, Employee } from '@/types'
import { getAttendanceStatus } from '@/types'
import { formatDateIST, formatTimeIST } from '@/hooks/useClock'

/** Escapes a value for safe inclusion in a CSV cell. */
function csvCell(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

/**
 * Builds a CSV string from attendance logs, matching the exact column
 * order from the spec: Employee ID, Employee Name, Date, Punch In,
 * Punch Out, Total Hours, Overtime Hours, Status.
 */
export function generateAttendanceCSV(
  logs: AttendanceLog[],
  employeeById: Map<string, Employee>
): string {
  const header = [
    'Employee ID',
    'Employee Name',
    'Date',
    'Punch In',
    'Punch Out',
    'Total Hours',
    'Overtime Hours',
    'Status',
  ]

  const rows = logs.map((log) => {
    const emp = employeeById.get(log.employeeId)
    const status = getAttendanceStatus(log)

    return [
      emp?.employeeId ?? log.employeeId,
      emp?.name ?? 'Unknown',
      formatDateIST(log.loginTime.toDate()),
      formatTimeIST(log.loginTime.toDate()),
      log.logoutTime ? formatTimeIST(log.logoutTime.toDate()) : '',
      log.totalHours !== null ? log.totalHours.toFixed(2) : '',
      log.overtimeHours !== null ? log.overtimeHours.toFixed(2) : '',
      status === 'active' ? 'Active' : 'Completed',
    ].map(csvCell)
  })

  return [header, ...rows].map((row) => row.join(',')).join('\n')
}

/**
 * Phase T10: generic CSV builder for report pages whose row shape doesn't
 * warrant its own named generator the way generateAttendanceCSV above
 * does — headers plus already-formatted string rows, each cell escaped
 * the same way.
 */
export function generateCSV(headers: string[], rows: string[][]): string {
  return [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\n')
}

/** Triggers a browser download of the given CSV string. */
export function downloadCSV(filename: string, csvContent: string): void {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)

  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)

  URL.revokeObjectURL(url)
}
