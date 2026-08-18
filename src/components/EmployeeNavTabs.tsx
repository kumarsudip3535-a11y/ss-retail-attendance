import { NavLink } from 'react-router-dom'
import { HomeIcon, ClockIcon, UserIcon } from '@/components/icons'

const tabs = [
  { to: '/dashboard', label: 'Dashboard', icon: HomeIcon },
  { to: '/attendance', label: 'Attendance', icon: ClockIcon },
  { to: '/profile', label: 'Profile', icon: UserIcon },
]

export default function EmployeeNavTabs() {
  return (
    <>
      {/* Desktop / tablet: horizontal tabs */}
      <nav className="hidden sm:block bg-white border-b border-slate-200">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 flex gap-6">
          {tabs.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
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
