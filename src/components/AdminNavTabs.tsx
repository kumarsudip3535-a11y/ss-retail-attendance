import { NavLink } from 'react-router-dom'
import { HomeIcon, UsersIcon, ChartIcon, SettingsIcon, MapIcon, TruckIcon, ReceiptIcon, WalletIcon, FlagAlertIcon } from '@/components/icons'

const tabs = [
  { to: '/admin', label: 'Dashboard', icon: HomeIcon, end: true },
  { to: '/admin/employees', label: 'Employees', icon: UsersIcon, end: false },
  { to: '/admin/live-tracking', label: 'Live Map', icon: MapIcon, end: false },
  { to: '/admin/vehicles', label: 'Vehicles', icon: TruckIcon, end: false },
  { to: '/admin/claims', label: 'Claims', icon: ReceiptIcon, end: false },
  { to: '/admin/payroll', label: 'Payroll', icon: WalletIcon, end: false },
  { to: '/admin/travel-reports', label: 'Travel Reports', icon: ChartIcon, end: false },
  { to: '/admin/data-review', label: 'Data Review', icon: FlagAlertIcon, end: false },
  { to: '/admin/reports', label: 'Reports', icon: ChartIcon, end: false },
  { to: '/admin/settings', label: 'Settings', icon: SettingsIcon, end: false },
]

export default function AdminNavTabs() {
  return (
    <>
      {/* Desktop / tablet: horizontal tabs */}
      <nav className="hidden sm:block bg-white border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 flex gap-6 overflow-x-auto">
          {tabs.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              className={({ isActive }) =>
                `py-3 text-sm font-medium border-b-2 transition-colors ${
                  isActive
                    ? 'border-brand-600 text-brand-700'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`
              }
            >
              {tab.label}
            </NavLink>
          ))}
        </div>
      </nav>

      {/* Mobile: fixed bottom nav */}
      <nav className="sm:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-slate-200 pb-[env(safe-area-inset-bottom)]">
        <div className="flex">
          {tabs.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              className={({ isActive }) =>
                `flex-1 flex flex-col items-center gap-0.5 py-2.5 text-xs font-medium ${
                  isActive ? 'text-brand-700' : 'text-slate-400'
                }`
              }
            >
              <tab.icon className="h-5 w-5" />
              {tab.label}
            </NavLink>
          ))}
        </div>
      </nav>
    </>
  )
}
