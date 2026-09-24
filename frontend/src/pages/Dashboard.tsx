import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { formatWhen } from '../lib/time'
import { Card, Spinner, StatusBadge, ErrorNote, Button } from '../components/ui'

interface SchedulerStatus {
  status: string
  ticking?: boolean
  lastTickAt?: string | null
  tickCount?: number
  jobsRun?: number
  activeSchedules?: number
  pendingApproval?: number
  pendingRetries?: number
  lastError?: string | null
}

interface Health {
  status: string
  backend: { ok: boolean; uptimeSec: number; mockLlm: boolean }
  database: { ok: boolean; path?: string; error?: string }
  ollama: { ok: boolean; version?: string; url: string }
  model: { name: string; available: boolean; hint?: string }
  whatsapp: { status: string; phase?: number }
  scheduler: SchedulerStatus
}

interface WaState {
  connected: boolean
  status: string
  phone: string | null
}

export default function Dashboard() {
  const [health, setHealth] = useState<Health | null>(null)
  const [wa, setWa] = useState<WaState | null>(null)
  const [error, setError] = useState('')
  const [stopping, setStopping] = useState(false)

  const load = useCallback(async () => {
    try {
      const [h, w] = await Promise.all([
        api.get<Health>('/api/health'),
        api.get<WaState>('/api/whatsapp/status'),
      ])
      setHealth(h)
      setWa(w)
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load health')
    }
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 15000)
    return () => clearInterval(t)
  }, [load])

  async function stopAll() {
    if (!confirm('Stop ALL automation? No scheduled messages will be sent until you resume.')) return
    setStopping(true)
    try {
      await api.post('/api/whatsapp/stop', { active: true })
      await load()
    } finally {
      setStopping(false)
    }
  }

  const h = health
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Dashboard</h1>
          <p className="text-sm text-slate-500">Live status of the local automation server</p>
        </div>
        <Button variant="danger" onClick={stopAll} loading={stopping}>
          🛑 Stop all automation
        </Button>
      </div>

      {error && <ErrorNote message={error} />}
      {!h && !error && <Spinner label="Checking system health…" />}

      {h && (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
            <Card><StatusBadge ok={h.backend.ok} label={`Backend${h.backend.mockLlm ? ' (mock)' : ''}`} /></Card>
            <Card><StatusBadge ok={h.database.ok} label="Database" hint={h.database.path || h.database.error} /></Card>
            <Card><StatusBadge ok={h.ollama.ok} label={`Ollama${h.ollama.version ? ' v' + h.ollama.version : ''}`} hint={h.ollama.url} /></Card>
            <Card><StatusBadge ok={h.model.available} label={`Model: ${h.model.name}`} hint={h.model.hint} /></Card>
            <Card><StatusBadge ok={wa ? wa.connected : null} label={`WhatsApp (${wa?.status ?? '…'})`} /></Card>
            <Card><StatusBadge ok={h.scheduler.status === 'running' ? true : null} label={`Scheduler (${h.scheduler.status})`} hint={h.scheduler.lastError ?? undefined} /></Card>
          </div>

          <Card title="Automation">
            <div className="grid grid-cols-2 gap-4 text-sm text-slate-600 lg:grid-cols-4">
              <div>
                <div className="text-2xl font-semibold text-slate-800">{h.scheduler.activeSchedules ?? 0}</div>
                <div>Active schedules</div>
              </div>
              <div>
                <div className="text-2xl font-semibold text-slate-800">{h.scheduler.jobsRun ?? 0}</div>
                <div>Messages sent by scheduler</div>
              </div>
              <div>
                <div className="text-2xl font-semibold text-slate-800">{h.scheduler.pendingApproval ?? 0}</div>
                <div>Awaiting approval</div>
              </div>
              <div>
                <div className="text-2xl font-semibold text-slate-800">{h.scheduler.lastTickAt ? formatWhen(h.scheduler.lastTickAt) : '—'}</div>
                <div>Last scheduler tick</div>
              </div>
            </div>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Next steps">
              <ul className="space-y-2 text-sm text-slate-600">
                <li>
                  1. Connect WhatsApp on the{' '}
                  <Link to="/whatsapp" className="font-medium text-indigo-600 hover:underline">WhatsApp page</Link>{' '}
                  (scan the QR once — the session persists).
                </li>
                <li>2. Pick groups and generate your first content.</li>
                <li>3. Schedule it — the local server keeps sending even when this tab is closed.</li>
              </ul>
            </Card>
            <Card title="Runtime">
              <dl className="space-y-1 text-sm text-slate-600">
                <div className="flex justify-between"><dt>Uptime</dt><dd>{Math.floor(h.backend.uptimeSec / 60)} min</dd></div>
                <div className="flex justify-between"><dt>Ollama URL</dt><dd className="font-mono text-xs">{h.ollama.url}</dd></div>
                <div className="flex justify-between"><dt>Overall</dt><dd><StatusBadge ok={h.status === 'ok'} label={h.status} /></dd></div>
              </dl>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
