import { useState } from 'react'
import { useAuth } from '@/context/AuthContext'
import { signOut } from '@/services/authService'
import ConfirmDialog from '@/components/ConfirmDialog'

export default function DashboardHeader() {
  const { employee } = useAuth()
  const [confirmingLogout, setConfirmingLogout] = useState(false)

  return (
    <header className="bg-white border-b border-slate-200">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
        <div>
          <img src="/logo.svg" alt="SS Retail Services" className="h-8 w-auto" />
          <p className="text-xs text-slate-400 mt-0.5">Attendance System</p>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right hidden sm:block">
            <p className="text-sm font-medium text-slate-800">
              {employee?.name}
            </p>
            <p className="text-xs text-slate-400">{employee?.employeeId}</p>
          </div>

          {employee?.photoUrl ? (
            <img
              src={employee.photoUrl}
              alt={employee.name}
              className="h-9 w-9 rounded-full object-cover border border-slate-200"
            />
          ) : (
            <div className="h-9 w-9 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-sm font-semibold">
              {employee?.name?.charAt(0)?.toUpperCase() ?? '?'}
            </div>
          )}

          <button
            onClick={() => setConfirmingLogout(true)}
            className="text-xs text-red-600 hover:text-red-700 font-medium"
          >
            Logout
          </button>
        </div>
      </div>

      {confirmingLogout && (
        <ConfirmDialog
          title="Log out?"
          message="You'll need to verify your mobile number again to sign back in."
          confirmLabel="Log Out"
          danger
          onConfirm={() => signOut()}
          onCancel={() => setConfirmingLogout(false)}
        />
      )}
    </header>
  )
}
