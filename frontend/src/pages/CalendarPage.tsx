import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'
import { to12h } from '../lib/time'
import { Button, Card, ErrorNote, Spinner } from '../components/ui'

interface Slot {
  scheduleId: number
  time: string
  group: string
  contentType: string
  topic: string | null
  topicSource: 'fixed' | 'category' | 'pool' | 'fallback'
}

interface Week {
  weekStart: string
  days: { date: string; day: string; slots: Slot[] }[]
}

const SOURCE_BADGE: Record<Slot['topicSource'], { label: string; cls: string }> = {
  fixed: { label: 'fixed', cls: 'bg-slate-100 text-slate-600 ring-slate-200' },
  category: { label: 'category rotation', cls: 'bg-indigo-50 text-indigo-700 ring-indigo-100' },
  pool: { label: 'rotation', cls: 'bg-indigo-50 text-indigo-700 ring-indigo-100' },
  fallback: { label: 'auto', cls: 'bg-amber-50 text-amber-700 ring-amber-100' },
}

export default function CalendarPage() {
  const [week, setWeek] = useState<Week | null>(null)
  const [weeksAhead, setWeeksAhead] = useState(0)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      setWeek(await api.get<Week>(`/api/calendar/week?weeksAhead=${weeksAhead}`))
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load calendar')
    }
  }, [weeksAhead])

  useEffect(() => {
    load()
  }, [load])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Content Calendar</h1>
          <p className="text-sm text-slate-500">
            Week of {week?.weekStart ?? '…'} — what each enabled schedule will post, with rotating topic previews
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => setWeeksAhead((w) => Math.max(0, w - 1))} disabled={weeksAhead === 0}>
            ← This week
          </Button>
          <Button variant="secondary" onClick={() => setWeeksAhead((w) => Math.min(8, w + 1))}>
            Next week →
          </Button>
        </div>
      </div>

      {error && <ErrorNote message={error} />}
      {!week && !error && <Spinner label="Building calendar…" />}

      {week && (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {week.days.map((d) => (
            <Card key={d.date} title={`${d.day} · ${d.date.slice(5)}`}>
              {d.slots.length === 0 ? (
                <p className="text-xs text-slate-400">No posts scheduled.</p>
              ) : (
                <ul className="space-y-2">
                  {d.slots.map((s) => (
                    <li key={s.scheduleId} className="rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-slate-100">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs font-semibold text-slate-700">{to12h(s.time)}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] ring-1 ${SOURCE_BADGE[s.topicSource].cls}`}>
                          {SOURCE_BADGE[s.topicSource].label}
                        </span>
                      </div>
                      <div className="mt-1 text-sm font-medium text-slate-800">{s.group}</div>
                      <div className="text-xs text-slate-500">
                        {s.contentType} · {s.topic ?? 'auto'}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
