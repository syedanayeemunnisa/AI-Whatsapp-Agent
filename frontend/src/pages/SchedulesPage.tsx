import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'
import { to12h } from '../lib/time'
import { TimePicker12 } from '../components/TimePicker12'
import { Button, Card, ErrorNote, Field, inputClass, Spinner, StatusBadge, SuccessNote } from '../components/ui'

interface Schedule {
  id: number
  group_id: number
  group_name: string | null
  topic: string | null
  content_type: string
  posting_time: string
  frequency: string
  day_of_week: number | null
  enabled: number
}

interface ConfiguredGroup { id: number; group_name: string; enabled: number }

const CONTENT_TYPES = ['Daily Tip', 'Educational Post', 'Quiz', 'Interview Question', 'Daily Challenge', 'Career Tip', 'Industry Update', 'Question of the Day', 'Course Promotion', 'Announcement']
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export default function SchedulesPage() {
  const [schedules, setSchedules] = useState<Schedule[] | null>(null)
  const [groups, setGroups] = useState<ConfiguredGroup[]>([])
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ groupId: '', contentType: 'Daily Tip', topic: '', postingTime: '09:00', frequency: 'daily', dayOfWeek: '1' })

  const load = useCallback(async () => {
    try {
      const [s, g] = await Promise.all([
        api.get<{ schedules: Schedule[] }>('/api/schedules'),
        api.get<{ groups: ConfiguredGroup[] }>('/api/groups'),
      ])
      setSchedules(s.schedules)
      setGroups(g.groups)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load schedules')
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function create(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api.post('/api/schedules', {
        groupId: Number(form.groupId),
        topic: form.topic || undefined,
        contentType: form.contentType,
        postingTime: form.postingTime,
        frequency: form.frequency,
        ...(form.frequency === 'weekly' ? { dayOfWeek: Number(form.dayOfWeek) } : {}),
      })
      setNote(`Schedule created ✓ — will post ${form.frequency === 'weekly' ? `${DAY_NAMES[Number(form.dayOfWeek)]}s ` : 'daily '}at ${to12h(form.postingTime)}`)
      setForm({ ...form, topic: '' })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create schedule')
    } finally {
      setBusy(false)
    }
  }

  async function toggle(s: Schedule) {
    await api.put(`/api/schedules/${s.id}`, { enabled: s.enabled ? 0 : 1 }).catch((err) => setError(err.message))
    await load()
  }

  async function remove(s: Schedule) {
    if (!confirm(`Delete the ${to12h(s.posting_time)} schedule for ${s.group_name ?? 'group'}?`)) return
    await api.del(`/api/schedules/${s.id}`).catch((err) => setError(err.message))
    await load()
  }

  const byHour = new Map<string, Schedule[]>()
  schedules?.forEach((s) => {
    const list = byHour.get(s.posting_time) ?? []
    list.push(s)
    byHour.set(s.posting_time, list)
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">Schedules</h1>
        <p className="text-sm text-slate-500">When each group gets its content (task §27). The backend scheduler checks every minute and sends automatically.</p>
      </div>

      {error && <ErrorNote message={error} />}
      {note && <SuccessNote message={note} />}

      <Card title="Timeline (by posting time)">
        {!schedules && <Spinner />}
        {schedules?.length === 0 && <p className="text-sm text-slate-500">No schedules yet.</p>}
        {byHour.size > 0 && (
          <div className="space-y-2">
            {[...byHour.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([time, list]) => (
              <div key={time} className="flex items-center gap-3">
                <span className="w-20 shrink-0 font-mono text-sm font-semibold text-slate-700">{to12h(time)}</span>
                <div className="flex flex-wrap gap-2">
                  {list.map((s) => (
                    <span key={s.id} className="rounded-full bg-indigo-50 px-3 py-1 text-xs text-indigo-800 ring-1 ring-indigo-100">
                      {s.group_name ?? `group #${s.group_id}`} · {s.content_type}
                      {!s.enabled && ' (disabled)'}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="New schedule">
        {groups.length === 0 ? (
          <p className="text-sm text-slate-500">Configure a group first (Groups page).</p>
        ) : (
          <form onSubmit={create} className="grid gap-3 md:grid-cols-5">
            <Field label="Group">
              <select className={inputClass} value={form.groupId} onChange={(e) => setForm({ ...form, groupId: e.target.value })} required>
                <option value="">— select —</option>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.group_name}</option>)}
              </select>
            </Field>
            <Field label="Content type">
              <select className={inputClass} value={form.contentType} onChange={(e) => setForm({ ...form, contentType: e.target.value })}>
                {CONTENT_TYPES.map((t) => <option key={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Topic (optional — agent can choose)">
              <input className={inputClass} value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })} placeholder="auto" />
            </Field>
            <Field label="Posting time (12-hour)">
              <TimePicker12 value={form.postingTime} onChange={(postingTime) => setForm({ ...form, postingTime })} />
            </Field>
            <Field label="Frequency">
              <select className={inputClass} value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value })}>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly (pick a day)</option>
              </select>
            </Field>
            {form.frequency === 'weekly' && (
              <Field label="Day of week">
                <select className={inputClass} value={form.dayOfWeek} onChange={(e) => setForm({ ...form, dayOfWeek: e.target.value })}>
                  {DAY_NAMES.map((d, i) => <option key={d} value={i}>{d}</option>)}
                </select>
              </Field>
            )}
            <div className="flex items-end">
              <Button type="submit" loading={busy} className="w-full">Add schedule</Button>
            </div>
          </form>
        )}
      </Card>

      <Card title={`All schedules (${schedules?.length ?? '…'})`}>
        {schedules && schedules.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                <th className="py-2">Time</th>
                <th>Group</th>
                <th>Type</th>
                <th>Topic</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {schedules.map((s) => (
                <tr key={s.id} className="border-b border-slate-100">
                  <td className="py-2 font-mono">
                    {s.frequency === 'weekly' && s.day_of_week != null ? `${DAY_NAMES[s.day_of_week].slice(0, 3)} ` : ''}
                    {to12h(s.posting_time)}
                  </td>
                  <td className="font-medium text-slate-800">{s.group_name ?? `#${s.group_id}`}</td>
                  <td>{s.content_type}</td>
                  <td>{s.topic ?? 'auto'}</td>
                  <td><StatusBadge ok={Boolean(s.enabled)} label={s.enabled ? 'enabled' : 'disabled'} /></td>
                  <td className="py-1 text-right">
                    <Button variant="ghost" className="!px-2 !py-1" onClick={() => toggle(s)}>{s.enabled ? 'Disable' : 'Enable'}</Button>
                    <Button variant="ghost" className="!px-2 !py-1 !text-red-600" onClick={() => remove(s)}>Delete</Button>
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
