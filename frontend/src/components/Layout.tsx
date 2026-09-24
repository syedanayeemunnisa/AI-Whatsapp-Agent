import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'

const NAV = [
  { to: '/', label: 'Dashboard', icon: '⌂' },
  { to: '/whatsapp', label: 'WhatsApp', icon: '✆' },
  { to: '/groups', label: 'Groups', icon: '👥' },
  { to: '/content', label: 'Content', icon: '📝' },
  { to: '/schedules', label: 'Schedules', icon: '⏰' },
  { to: '/calendar', label: 'Calendar', icon: '📅' },
  { to: '/logs', label: 'Logs', icon: '📊' },
  { to: '/settings', label: 'Settings', icon: '⚙' },
]

export default function Layout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  return (
    <div className="flex min-h-full">
      <aside className="flex w-56 shrink-0 flex-col bg-slate-900 text-slate-300">
        <div className="px-4 py-5">
          <div className="text-base font-bold text-white">AI WhatsApp Agent</div>
          <div className="text-xs text-slate-400">Content Automation</div>
        </div>
        <nav className="flex-1 space-y-1 px-2">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
                  isActive ? 'bg-indigo-600 text-white' : 'hover:bg-slate-800 hover:text-white'
                }`
              }
            >
              <span className="w-4 text-center opacity-80">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-slate-800 p-3">
          <div className="mb-2 px-1 text-xs text-slate-400">
            {user?.name} <span className="text-slate-500">({user?.role})</span>
          </div>
          <button
            onClick={() => {
              logout()
              navigate('/login')
            }}
            className="w-full rounded-lg px-3 py-1.5 text-left text-sm text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            Log out
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto p-6">
        <Outlet />
      </main>
    </div>
  )
}
