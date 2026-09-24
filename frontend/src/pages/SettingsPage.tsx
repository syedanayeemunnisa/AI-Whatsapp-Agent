import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'
import { formatWhen } from '../lib/time'
import { Button, Card, ErrorNote, Field, inputClass, Spinner, StatusBadge, SuccessNote } from '../components/ui'

interface AuditRow {
  id: number
  user_email: string | null
  action: string
  detail: string | null
  created_at: string
}

interface Settings {
  automation_mode: string
  emergency_stop: string
  max_messages_per_hour: string
  min_delay_seconds: string
  max_groups_per_cycle: string
  default_model: string
  default_tone: string
  default_language: string
  validation_strictness: string
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [stopBusy, setStopBusy] = useState(false)
  const [auditRows, setAuditRows] = useState<AuditRow[] | null>(null)

  const loadAudit = useCallback(async () => {
    try {
      const res = await api.get<{ items: AuditRow[] }>('/api/system/audit?limit=12')
      setAuditRows(res.items)
    } catch {
      setAuditRows([]) // non-admin or older backend — just hide the card
    }
  }, [])

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ settings: Settings }>('/api/settings')
      setSettings(res.settings)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load settings')
    }
  }, [])

  useEffect(() => {
    load()
    loadAudit()
  }, [load, loadAudit])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!settings) return
    setBusy(true)
    setError('')
    setNote('')
    try {
      await api.put('/api/settings', {
        automation_mode: settings.automation_mode,
        max_messages_per_hour: settings.max_messages_per_hour,
        min_delay_seconds: settings.min_delay_seconds,
        max_groups_per_cycle: settings.max_groups_per_cycle,
        default_model: settings.default_model,
        default_tone: settings.default_tone,
        default_language: settings.default_language,
        validation_strictness: settings.validation_strictness,
      })
      setNote('Settings saved ✓')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  async function setEmergencyStop(active: boolean) {
    setStopBusy(true)
    setError('')
    try {
      await api.post(active ? '/api/automation/stop' : '/api/automation/start')
      setNote(active ? '🛑 Emergency stop ACTIVE — no messages will be sent.' : '✅ Automation resumed.')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle emergency stop')
    } finally {
      setStopBusy(false)
    }
  }

  const stopped = settings?.emergency_stop === 'true'

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">Settings</h1>
        <p className="text-sm text-slate-500">Automation behaviour and safety limits (tasks §29, §30, §40)</p>
      </div>

      {error && <ErrorNote message={error} />}
      {note && <SuccessNote message={note} />}

      <Card title="Automation status">
        {!settings ? (
          <Spinner />
        ) : (
          <div className="flex flex-wrap items-center gap-4">
            <StatusBadge
              ok={stopped ? false : true}
              label={stopped ? 'STOPPED (emergency stop)' : `ACTIVE · ${settings.automation_mode}`}
            />
            {stopped ? (
              <Button onClick={() => setEmergencyStop(false)} loading={stopBusy}>▶ Resume automation</Button>
            ) : (
              <Button variant="danger" onClick={() => setEmergencyStop(true)} loading={stopBusy}>
                🛑 Emergency stop — halt all sending
              </Button>
            )}
          </div>
        )}
      </Card>

      {settings && (
        <Card title="Preferences">
          <form onSubmit={save} className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            <Field label="Automation mode">
              <select className={inputClass} value={settings.automation_mode} onChange={(e) => setSettings({ ...settings, automation_mode: e.target.value })}>
                <option value="manual_approval">Manual approval (default — review before send)</option>
                <option value="automatic">Automatic (generate → validate → send)</option>
              </select>
            </Field>
            <Field label="Max messages per hour">
              <input type="number" min="1" max="20" className={inputClass} value={settings.max_messages_per_hour} onChange={(e) => setSettings({ ...settings, max_messages_per_hour: e.target.value })} />
            </Field>
            <Field label="Min delay between sends (seconds)">
              <input type="number" min="5" max="600" className={inputClass} value={settings.min_delay_seconds} onChange={(e) => setSettings({ ...settings, min_delay_seconds: e.target.value })} />
            </Field>
            <Field label="Max groups per automation cycle">
              <input type="number" min="1" max="10" className={inputClass} value={settings.max_groups_per_cycle} onChange={(e) => setSettings({ ...settings, max_groups_per_cycle: e.target.value })} />
            </Field>
            <Field label="Default model">
              <input className={inputClass} value={settings.default_model} onChange={(e) => setSettings({ ...settings, default_model: e.target.value })} />
            </Field>
            <Field label="Default language">
              <input className={inputClass} value={settings.default_language} onChange={(e) => setSettings({ ...settings, default_language: e.target.value })} />
            </Field>
            <Field label="AI content validation">
              <select className={inputClass} value={settings.validation_strictness} onChange={(e) => setSettings({ ...settings, validation_strictness: e.target.value })}>
                <option value="normal">Normal — block fabricated stats, contact info, spam</option>
                <option value="strict">Strict — also block all links, tighter emoji limit</option>
              </select>
            </Field>
            <div className="md:col-span-2 lg:col-span-3">
              <Button type="submit" loading={busy}>Save settings</Button>
            </div>
          </form>
          <p className="mt-3 text-xs text-slate-400">
            Safety note: hourly caps, per-send delays and the emergency stop are enforced server-side on every send,
            independent of this dashboard (task §40).
          </p>
        </Card>
      )}

      {auditRows && auditRows.length > 0 && (
        <Card title="Recent admin activity (audit trail)">
          <table className="w-full text-sm">
            <tbody>
              {auditRows.map((r) => (
                <tr key={r.id} className="border-b border-slate-100 last:border-0">
                  <td className="py-1.5 pr-3 whitespace-nowrap text-xs text-slate-500">{formatWhen(r.created_at)}</td>
                  <td className="py-1.5 pr-3 font-mono text-xs text-indigo-700">{r.action}</td>
                  <td className="py-1.5 pr-3 text-xs text-slate-600">{r.user_email ?? '—'}</td>
                  <td className="py-1.5 text-xs text-slate-400 max-w-xs truncate" title={r.detail ?? ''}>{r.detail ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}
