import { useAuth } from '@/context/AuthContext'
import DashboardHeader from '@/components/DashboardHeader'
import EmployeeNavTabs from '@/components/EmployeeNavTabs'

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-slate-100 last:border-0">
      <span className="text-sm text-slate-400">{label}</span>
      <span className="text-sm font-medium text-slate-800">{value}</span>
    </div>
  )
}

export default function ProfilePage() {
  const { employee } = useAuth()

  if (!employee) return null

  return (
    <div className="min-h-screen bg-slate-50">
      <DashboardHeader />
      <EmployeeNavTabs />

      <main className="max-w-3xl mx-auto px-4 sm:px-6 pt-6 pb-24 sm:pb-6">
        <div className="rounded-2xl bg-white shadow-sm border border-slate-200 p-6">
          <div className="flex items-center gap-4">
            {employee.photoUrl ? (
              <img
                src={employee.photoUrl}
                alt={employee.name}
                className="h-16 w-16 rounded-full object-cover border border-slate-200"
              />
            ) : (
              <div className="h-16 w-16 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-xl font-semibold">
                {employee.name.charAt(0).toUpperCase()}
              </div>
            )}
            <div>
              <h1 className="text-lg font-semibold text-slate-800">
                {employee.name}
              </h1>
              <p className="text-sm text-slate-400">{employee.employeeId}</p>
            </div>
          </div>

          <div className="mt-6">
            <InfoRow label="Mobile Number" value={employee.phone} />
            <InfoRow
              label="Role"
              value={
                employee.role.charAt(0).toUpperCase() + employee.role.slice(1)
              }
            />
            <InfoRow
              label="Assigned Office"
              value={`${employee.officeLat.toFixed(4)}, ${employee.officeLng.toFixed(4)}`}
            />
            <InfoRow
              label="Geofence Radius"
              value={`${employee.geofenceRadius}m`}
            />
          </div>

          <p className="mt-4 text-xs text-slate-400">
            Employee ID, role, and office assignment can only be changed by
            an administrator.
          </p>
        </div>
      </main>
    </div>
  )
}
