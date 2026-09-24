import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { api, clearSession, getStoredUser, setSession, ApiError } from '../lib/api'

export interface User {
  id: number
  name: string
  email: string
  role: string
}

interface AuthState {
  user: User | null
  needsBootstrap: boolean
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  bootstrap: (name: string, email: string, password: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(getStoredUser())
  const [needsBootstrap, setNeedsBootstrap] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function check() {
      if (!getStoredUser()) {
        setLoading(false)
        return
      }
      try {
        await api.get<{ user: User }>('/api/auth/me')
        if (!cancelled) setLoading(false)
      } catch (err) {
        if (!cancelled) {
          clearSession()
          setUser(null)
          setLoading(false)
          if (err instanceof ApiError && (err.status === 0 || err.status === 404)) {
            setNeedsBootstrap(false)
          }
        }
      }
    }
    check()
    return () => {
      cancelled = true
    }
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.post<{ token: string; user: User }>('/api/auth/login', { email, password })
    setSession(res.token, res.user)
    setUser(res.user)
  }, [])

  const bootstrap = useCallback(async (name: string, email: string, password: string) => {
    await api.post('/api/auth/bootstrap', { name, email, password })
    // auto-login right after
    await login(email, password)
  }, [login])

  const logout = useCallback(() => {
    clearSession()
    setUser(null)
  }, [])

  const value = useMemo(
    () => ({ user, needsBootstrap, loading, login, bootstrap, logout }),
    [user, needsBootstrap, loading, login, bootstrap, logout]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
