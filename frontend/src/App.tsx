import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth/AuthContext'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import WhatsAppPage from './pages/WhatsAppPage'
import GroupsPage from './pages/GroupsPage'
import ContentPage from './pages/ContentPage'
import SchedulesPage from './pages/SchedulesPage'
import CalendarPage from './pages/CalendarPage'
import LogsPage from './pages/LogsPage'
import SettingsPage from './pages/SettingsPage'
import { Spinner } from './components/ui'

function Protected({ children }: { children: React.ReactElement }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="flex min-h-full items-center justify-center"><Spinner label="Checking session…" /></div>
  if (!user) return <Navigate to="/login" replace />
  return children
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            element={
              <Protected>
                <Layout />
              </Protected>
            }
          >
            <Route path="/" element={<Dashboard />} />
            <Route path="/whatsapp" element={<WhatsAppPage />} />
            <Route path="/groups" element={<GroupsPage />} />
            <Route path="/content" element={<ContentPage />} />
            <Route path="/schedules" element={<SchedulesPage />} />
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/logs" element={<LogsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
