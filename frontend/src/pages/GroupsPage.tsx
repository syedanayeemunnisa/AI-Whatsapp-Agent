import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'
import { to12h } from '../lib/time'
import { TimePicker12 } from '../components/TimePicker12'
import { Button, Card, ErrorNote, Field, inputClass, Spinner, StatusBadge, SuccessNote } from '../components/ui'

interface ConfiguredGroup {
  id: number
  group_name: string
  whatsapp_group_id: string
  enabled: number
  category: string | null
  audience: string | null
  posting_time: string | null
  frequency: string
}

interface DetectedGroup {
  chatId: string
  name: string
  participantCount: number | null
}

const CATEGORIES = ['Data Analytics', 'Data Science', 'SQL', 'Power BI', 'Python', 'Artificial Intelligence', 'Machine Learning', 'Generative AI', 'Digital Marketing', 'SEO', 'Career', 'Interview Preparation', 'Technology']

export default function GroupsPage() {
  const [configured, setConfigured] = useState<ConfiguredGroup[] | null>(null)
  const [detected, setDetected] = useState<DetectedGroup[]>([])
  const [detectNote, setDetectNote] = useState('')
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [adding, setAdding] = useState<DetectedGroup | null>(null)
  const [form, setForm] = useState({ category: CATEGORIES[0], audience: 'Students', postingTime: '09:00', frequency: 'daily' })
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ groups: ConfiguredGroup[] }>('/api/groups')
      setConfigured(res.groups)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load groups')
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function detect() {
    setBusy(true)
    setError('')
    setDetectNote('')
    try {
      const res = await api.get<{ count: number; groups: DetectedGroup[] }>('/api/whatsapp/groups')
      setDetected(res.groups)
      setDetectNote(res.count ? `${res.count} groups found on WhatsApp` : 'No groups found — is WhatsApp connected?')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Detection failed — connect WhatsApp first')
    } finally {
      setBusy(false)
    }
  }

  async function addGroup(e: React.FormEvent) {
    e.preventDefault()
    if (!adding) return
    setBusy(true)
    try {
      await api.post('/api/groups', { groupName: adding.name, chatId: adding.chatId, ...form })
      setNote(`"${adding.name}" configured ✓`)
      setAdding(null)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to configure group')
    } finally {
      setBusy(false)
    }
  }

  async function toggle(g: ConfiguredGroup) {
    await api.put(`/api/groups/${g.id}`, { enabled: g.enabled ? 0 : 1 }).catch((err) => setError(err.message))
    await load()
  }

  async function remove(g: ConfiguredGroup) {
    if (!confirm(`Remove configuration for "${g.group_name}"?`)) return
    await api.del(`/api/groups/${g.id}`).catch((err) => setError(err.message))
    await load()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Groups</h1>
          <p className="text-sm text-slate-500">Configure which WhatsApp groups receive content (task §13–§14)</p>
        </div>
        <Button variant="secondary" onClick={detect} loading={busy}>🔄 Detect groups on WhatsApp</Button>
      </div>

      {error && <ErrorNote message={error} />}
      {note && <SuccessNote message={note} />}
      {detectNote && <SuccessNote message={detectNote} />}

      {detected.length > 0 && (
        <Card title="Detected on WhatsApp — click to configure">
          <div className="grid gap-2 md:grid-cols-2">
            {detected
              .filter((d) => !configured?.some((c) => c.whatsapp_group_id === d.chatId))
              .map((d) => (
                <button
                  key={d.chatId}
                  onClick={() => setAdding(d)}
                  className="rounded-lg px-3 py-2 text-left text-sm ring-1 ring-slate-200 hover:bg-indigo-50"
                >
                  <span className="font-medium text-slate-800">{d.name}</span>
                  <span className="ml-2 text-xs text-slate-400">{d.participantCount ?? '?'} members</span>
                </button>
              ))}
          </div>
        </Card>
      )}

      {adding && (
        <Card title={`Configure "${adding.name}"`}>
          <form onSubmit={addGroup} className="grid gap-3 md:grid-cols-4">
            <Field label="Content category">
              <select className={inputClass} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Audience">
              <input className={inputClass} value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })} />
            </Field>
            <Field label="Posting time (12-hour)">
              <TimePicker12 value={form.postingTime} onChange={(postingTime) => setForm({ ...form, postingTime })} />
            </Field>
            <Field label="Frequency">
              <select className={inputClass} value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value })}>
                <option value="daily">daily</option>
                <option value="weekdays">weekdays</option>
              </select>
            </Field>
            <div className="flex gap-2 md:col-span-4">
              <Button type="submit" loading={busy}>Save configuration</Button>
              <Button variant="secondary" onClick={() => setAdding(null)}>Cancel</Button>
            </div>
          </form>
        </Card>
      )}

      <Card title={`Configured groups (${configured?.length ?? '…'})`}>
        {!configured && <Spinner />}
        {configured?.length === 0 && (
          <p className="text-sm text-slate-500">None yet — click “Detect groups on WhatsApp” above.</p>
        )}
        {configured && configured.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                <th className="py-2">Group</th>
                <th>Category</th>
                <th>Audience</th>
                <th>Time</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {configured.map((g) => (
                <tr key={g.id} className="border-b border-slate-100">
                  <td className="py-2 font-medium text-slate-800">{g.group_name}</td>
                  <td>{g.category ?? '—'}</td>
                  <td>{g.audience ?? '—'}</td>
                  <td>{g.posting_time ? to12h(g.posting_time) : '—'}</td>
                  <td><StatusBadge ok={Boolean(g.enabled)} label={g.enabled ? 'enabled' : 'disabled'} /></td>
                  <td className="py-1 text-right">
                    <Button variant="ghost" className="!px-2 !py-1" onClick={() => toggle(g)}>{g.enabled ? 'Disable' : 'Enable'}</Button>
                    <Button variant="ghost" className="!px-2 !py-1 !text-red-600" onClick={() => remove(g)}>Remove</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  )
}
