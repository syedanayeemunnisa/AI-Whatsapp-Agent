import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { api } from '../lib/api'
import { Button, ErrorNote, Field, inputClass } from '../components/ui'

export default function Login() {
  const { user, login, bootstrap } = useAuth()
  const navigate = useNavigate()
  const [mode, setMode] = useState<'login' | 'bootstrap'>('login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // If no account exists yet, the app is in first-run mode
  useEffect(() => {
    api
      .get<{ bootstrapped: boolean }>('/api/auth/status')
      .then((s) => setMode(s.bootstrapped ? 'login' : 'bootstrap'))
      .catch(() => setMode('login'))
  }, [])

  useEffect(() => {
    if (user) navigate('/', { replace: true })
  }, [user, navigate])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      if (mode === 'bootstrap') await bootstrap(name, email, password)
      else await login(email, password)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-slate-900 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="text-2xl font-bold text-white">AI WhatsApp Agent</div>
          <div className="text-sm text-slate-400">Content Automation Dashboard</div>
        </div>
        <form onSubmit={submit} className="space-y-4 rounded-xl bg-white p-6 shadow-lg">
          <h1 className="text-lg font-semibold">{mode === 'bootstrap' ? 'Create admin account' : 'Log in'}</h1>
          {error && <ErrorNote message={error} />}
          {mode === 'bootstrap' && (
            <Field label="Name">
              <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} required />
            </Field>
          )}
          <Field label="Email">
            <input
              className={inputClass}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={mode === 'bootstrap' ? 'you@example.com' : 'admin@local'}
              required
            />
          </Field>
          <Field label="Password">
            <input
              className={inputClass}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === 'bootstrap' ? 'at least 8 characters' : ''}
              required
            />
          </Field>
          <Button type="submit" loading={busy} className="w-full">
            {mode === 'bootstrap' ? 'Create account & continue' : 'Log in'}
          </Button>
          <p className="text-center text-xs text-slate-500">
            {mode === 'bootstrap'
              ? 'First run: this account becomes the admin.'
              : 'First time here? The admin account is created on the local server.'}
          </p>
        </form>
      </div>
    </div>
  )
}
