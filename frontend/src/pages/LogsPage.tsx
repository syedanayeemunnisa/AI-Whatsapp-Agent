import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'
import { formatWhen } from '../lib/time'
import { Card, ErrorNote, Spinner, StatusBadge } from '../components/ui'

/** Translate internal error codes into plain English for the log table. */
const ERROR_LABELS: Record<string, string> = {
  no_topic_available: 'No topic in the topic pool — add topics on the Content page (now auto-falls back to the content type)',
  group_not_configured: 'The group this schedule pointed at is no longer configured',
  validation_flagged: 'The AI output failed safety/quality checks',
  'Hourly cap reached': 'Hourly send limit reached — will retry later',
  EMERGENCY_STOP: 'Emergency stop is active — sending halted',
  WA_NOT_CONNECTED: 'WhatsApp was not connected at send time',
  NOT_A_GROUP: 'The saved chat ID is no longer a WhatsApp group',
}

function friendlyError(msg: string | null): string {
  if (!msg) return ''
  for (const [needle, label] of Object.entries(ERROR_LABELS)) {
    if (msg.includes(needle)) return label
  }
  return msg
}

interface LogRow {
  id: number
  group_name: string | null
  topic: string | null
  scheduled_at: string | null
  sent_at: string | null
  status: string
  error_message: string | null
  retry_count: number
}

export default function LogsPage() {
  const [logs, setLogs] = useState<LogRow[] | null>(null)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const qs = status ? `?status=${encodeURIComponent(status)}&limit=200` : '?limit=200'
      const res = await api.get<{ logs: LogRow[] }>(`/api/logs${qs}`)
      setLogs(res.logs)
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load logs')
    }
  }, [status])

  useEffect(() => {
    load()
    const t = setInterval(load, 20000)
    return () => clearInterval(t)
  }, [load])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Message Logs</h1>
          <p className="text-sm text-slate-500">Every send attempt with failure reasons (task §32)</p>
        </div>
        <select className="rounded-lg px-3 py-2 text-sm ring-1 ring-slate-300" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="sent">Sent</option>
          <option value="failed">Failed</option>
          <option value="pending_approval">Pending approval</option>
          <option value="skipped_duplicate">Skipped (duplicate)</option>
          <option value="skipped">Skipped</option>
        </select>
      </div>

      {error && <ErrorNote message={error} />}
      <Card>
        {!logs && <Spinner />}
        {logs?.length === 0 && <p className="text-sm text-slate-500">No messages logged yet — send a test from the Content page.</p>}
        {logs && logs.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                <th className="py-2">When</th>
                <th>Group</th>
                <th>Topic</th>
                <th>Status</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id} className="border-b border-slate-100 align-top">
                  <td className="py-2 whitespace-nowrap text-slate-600">{formatWhen(l.sent_at ?? l.scheduled_at)}</td>
                  <td className="font-medium text-slate-800">{l.group_name ?? '—'}</td>
                  <td>{l.topic ?? '—'}</td>
                  <td><StatusBadge ok={l.status === 'sent'} label={l.status} /></td>
                  <td className={`max-w-xs text-xs ${l.status === 'failed' ? 'text-red-600' : 'text-slate-500'}`}>{friendlyError(l.error_message)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  )
}
