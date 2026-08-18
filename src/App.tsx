import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { AuthProvider } from '@/context/AuthContext'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import ProtectedRoute from '@/components/ProtectedRoute'
import LoginPage from '@/pages/LoginPage'
import EmployeeDashboardPage from '@/pages/EmployeeDashboardPage'
import AdminDashboardPage from '@/pages/AdminDashboardPage'
import ProfilePage from '@/pages/ProfilePage'
import AttendanceHistoryPage from '@/pages/AttendanceHistoryPage'
import EmployeeManagementPage from '@/pages/EmployeeManagementPage'
import ReportsPage from '@/pages/ReportsPage'
import AdminSettingsPage from '@/pages/AdminSettingsPage'
import AdminLiveTrackingPage from '@/pages/AdminLiveTrackingPage'
import RouteReplayPage from '@/pages/RouteReplayPage'
import VehicleManagementPage from '@/pages/VehicleManagementPage'
import TravelClaimPage from '@/pages/TravelClaimPage'
import AdminClaimsQueuePage from '@/pages/AdminClaimsQueuePage'
import AdminPayrollPage from '@/pages/AdminPayrollPage'
import TravelReportsPage from '@/pages/TravelReportsPage'
import DataReviewQueuePage from '@/pages/DataReviewQueuePage'

function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <Toaster position="top-center" />
          <Routes>
            <Route path="/login" element={<LoginPage />} />

            <Route
              path="/dashboard"
              element={
                <ProtectedRoute requiredRole="employee">
                  <EmployeeDashboardPage />
                </ProtectedRoute>
              }
            />

            <Route
              path="/admin"
              element={
                <ProtectedRoute requiredRole="admin">
                  <AdminDashboardPage />
                </ProtectedRoute>
              }
            />

            <Route
              path="/admin/employees"
              element={
                <ProtectedRoute requiredRole="admin">
                  <EmployeeManagementPage />
                </ProtectedRoute>
              }
            />

            <Route
              path="/admin/live-tracking"
              element={
                <ProtectedRoute requiredRole="admin">
                  <AdminLiveTrackingPage />
                </ProtectedRoute>
              }
            />

            <Route
              path="/admin/vehicles"
              element={
                <ProtectedRoute requiredRole="admin">
                  <VehicleManagementPage />
                </ProtectedRoute>
              }
            />

            <Route
              path="/admin/claims"
              element={
                <ProtectedRoute requiredRole="admin">
                  <AdminClaimsQueuePage />
                </ProtectedRoute>
              }
            />

            <Route
              path="/admin/payroll"
              element={
                <ProtectedRoute requiredRole="admin">
                  <AdminPayrollPage />
                </ProtectedRoute>
              }
            />

            <Route
              path="/admin/travel-reports"
              element={
                <ProtectedRoute requiredRole="admin">
                  <TravelReportsPage />
                </ProtectedRoute>
              }
            />

            <Route
              path="/admin/data-review"
              element={
                <ProtectedRoute requiredRole="admin">
                  <DataReviewQueuePage />
                </ProtectedRoute>
              }
            />

            <Route
              path="/admin/reports"
              element={
                <ProtectedRoute requiredRole="admin">
                  <ReportsPage />
                </ProtectedRoute>
              }
            />

            <Route
              path="/admin/settings"
              element={
                <ProtectedRoute requiredRole="admin">
                  <AdminSettingsPage />
                </ProtectedRoute>
              }
            />

            <Route
              path="/profile"
              element={
                <ProtectedRoute requiredRole="employee">
                  <ProfilePage />
                </ProtectedRoute>
              }
            />

            <Route
              path="/attendance"
              element={
                <ProtectedRoute requiredRole="employee">
                  <AttendanceHistoryPage />
                </ProtectedRoute>
              }
            />

            {/* No requiredRole: both employees and admins can reach this
                route. Real authorization is Firestore rules (isSelf ||
                isAdmin) on the underlying trackingSessions/locationPoints
                reads, same pattern as everywhere else in this app. */}
            <Route
              path="/replay/:employeeId/:attendanceLogId"
              element={
                <ProtectedRoute>
                  <RouteReplayPage />
                </ProtectedRoute>
              }
            />

            {/* Phase T9: same no-requiredRole pattern as /replay above —
                the employee's own claim vs. an admin's review view is
                decided inside TravelClaimPage itself (viewerIsAdmin), and
                real authorization is the travelClaims Firestore rules
                (isSelf || isAdmin). */}
            <Route
              path="/claim/:employeeId/:attendanceLogId"
              element={
                <ProtectedRoute>
                  <TravelClaimPage />
                </ProtectedRoute>
              }
            />

            <Route path="/" element={<Navigate to="/login" replace />} />
            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  )
}

export default App
