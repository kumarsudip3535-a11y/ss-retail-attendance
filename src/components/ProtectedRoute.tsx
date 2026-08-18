import { Navigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth } from '@/context/AuthContext'
import type { UserRole } from '@/types'

interface ProtectedRouteProps {
  children: ReactNode
  /** If set, only employees with this role may view the route */
  requiredRole?: UserRole
}

/**
 * Gates a route behind Firebase authentication and, optionally, a specific
 * employee role. This is a UI convenience only — real authorization lives
 * in Firestore Security Rules (Phase 12). Never treat this as the actual
 * security boundary.
 */
export default function ProtectedRoute({
  children,
  requiredRole,
}: ProtectedRouteProps) {
  const { firebaseUser, employee, loading, isUnregistered } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-sm text-slate-400">Loading…</p>
      </div>
    )
  }

  if (!firebaseUser) {
    return <Navigate to="/login" replace />
  }

  if (isUnregistered || !employee) {
    return <Navigate to="/login" replace state={{ unregistered: true }} />
  }

  if (requiredRole && employee.role !== requiredRole) {
    // Signed in, registered, but wrong role for this route. Only redirect
    // to a known-different destination — an unrecognized role value
    // (e.g. a data-entry typo in Firestore, such as "employees" instead
    // of "employee") must never resolve back to the current route, since
    // that produces a silent redirect loop with nothing rendered.
    const fallback: string | null =
      employee.role === 'admin'
        ? '/admin'
        : employee.role === 'employee'
          ? '/dashboard'
          : null

    if (!fallback) {
      console.error(
        `[ProtectedRoute] Employee has an unrecognized role: "${employee.role}". Expected "employee" or "admin".`
      )
      return (
        <div className="min-h-screen flex items-center justify-center px-4">
          <div className="max-w-sm text-center">
            <p className="text-sm text-red-600">
              Your account has an invalid role configured. Please contact
              the administrator.
            </p>
          </div>
        </div>
      )
    }

    return <Navigate to={fallback} replace />
  }

  return <>{children}</>
}
