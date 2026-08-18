import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import type { User } from 'firebase/auth'
import { subscribeToAuthChanges, findEmployeeByPhone } from '@/services/authService'
import type { Employee } from '@/types'

interface AuthContextValue {
  /** Firebase auth user, or null if not signed in */
  firebaseUser: User | null
  /** Matching employees/{id} record, or null if this phone isn't registered */
  employee: Employee | null
  /** True while the initial auth check + employee lookup is in progress */
  loading: boolean
  /** True once we've confirmed a signed-in user's phone has no employee record */
  isUnregistered: boolean
  /** Re-runs the employee lookup (e.g. after an admin edits your record) */
  refreshEmployee: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null)
  const [employee, setEmployee] = useState<Employee | null>(null)
  const [loading, setLoading] = useState(true)
  const [isUnregistered, setIsUnregistered] = useState(false)

  async function loadEmployeeForUser(user: User | null) {
    if (!user || !user.phoneNumber) {
      setEmployee(null)
      setIsUnregistered(false)
      return
    }

    try {
      const record = await findEmployeeByPhone(user.phoneNumber)
      setEmployee(record)
      setIsUnregistered(record === null)
    } catch (error) {
      console.error('[AuthContext] Failed to look up employee record:', error)
      setEmployee(null)
      setIsUnregistered(false)
    }
  }

  useEffect(() => {
    const unsubscribe = subscribeToAuthChanges(async (user) => {
      setLoading(true)
      setFirebaseUser(user)
      await loadEmployeeForUser(user)
      setLoading(false)
    })

    return unsubscribe
  }, [])

  async function refreshEmployee() {
    await loadEmployeeForUser(firebaseUser)
  }

  return (
    <AuthContext.Provider
      value={{ firebaseUser, employee, loading, isUnregistered, refreshEmployee }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return ctx
}
