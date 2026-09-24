import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'
import { Button, Card, ErrorNote, Field, inputClass, Spinner, StatusBadge, SuccessNote } from '../components/ui'

interface ContentItem {
  id: number
  group_id: number | null
  topic: string
  content: string
  content_type: string
  tone: string | null
  audience: string | null
  language: string | null
  model: string
  generated_at: string
  approved: number
  status: string
  validation?: { ok: boolean; issues: string[] }
  duplicateWarning?: { message: string } | null
}

const CONTENT_TYPES = ['Daily Tip', 'Educational Post', 'Quiz', 'Interview Question', 'Daily Challenge', 'Career Tip', 'Industry Update', 'Question of the Day', 'Course Promotion', 'Announcement']

export default function ContentPage() {
  const [items, setItems] = useState<ContentItem[] | null>(null)
  const [topic, setTopic] = useState('')
  const [audience, setAudience] = useState('Data Analytics Students')
  const [contentType, setContentType] = useState('Daily Tip')
  const [tone, setTone] = useState('Friendly and Educational')
  const [language, setLanguage] = useState('English')
  const [bypassDuplicate, setBypassDuplicate] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [editing, setEditing] = useState<ContentItem | null>(null)
  const [editText, setEditText] = useState('')
  const [testTarget, setTestTarget] = useState('')
  const [groups, setGroups] = useState<{ chatId: string; name: string }[]>([])

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ items: ContentItem[] }>('/api/content?limit=50')
      setItems(res.items)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load content')
    }
  }, [])

  useEffect(() => {
    load()
    api.get<{ groups: { chatId: string; name: string }[] }>('/api/whatsapp/groups')
      .then((r) => setGroups(r.groups))
      .catch(() => setGroups([]))
  }, [load])

  async function generate(e?: React.FormEvent) {
    e?.preventDefault()
    setGenerating(true)
    setError('')
    setNote('')
    try {
      const res = await api.post<ContentItem>(
        '/api/content/generate',
        { topic, audience, contentType, tone, language, bypassDuplicate },
        240000
      )
      setNote(
        res.duplicateWarning
          ? `Generated (⚠ ${res.duplicateWarning.message})`
          : res.validation?.ok
            ? 'Content generated ✓'
            : `Generated but flagged: ${res.validation?.issues?.join('; ')}`
      )
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed')
    } finally {
      setGenerating(false)
    }
  }

  async function approve(id: number) {
    try {
      await api.post(`/api/content/${id}/approve`)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Approve failed')
    }
  }

  async function regenerate(id: number) {
    setGenerating(true)
    setError('')
    try {
      await api.post(`/api/content/${id}/regenerate`, {}, 240000)
      setNote('Regenerated ✓ (old version kept as superseded)')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Regenerate failed')
    } finally {
      setGenerating(false)
    }
  }

  async function discard(id: number) {
    try {
      await api.del(`/api/content/${id}`)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Discard failed')
    }
  }

  async function saveEdit() {
    if (!editing) return
    try {
      await api.put(`/api/content/${editing.id}`, { content: editText })
      setEditing(null)
      setNote('Saved ✓ (editing is never blocked)')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    }
  }

  async function sendTest(item: ContentItem) {
    setError('')
    setNote('')
    if (!testTarget) {
      setError('Pick a test group first (only this one group receives the message).')
      return
    }
    try {
      await api.post('/api/whatsapp/test', { chatId: testTarget, contentId: item.id }, 60000)
      setNote(`Test message sent to "${groups.find((g) => g.chatId === testTarget)?.name ?? testTarget}" ✓`)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Send failed — is WhatsApp connected?')
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">Content</h1>
        <p className="text-sm text-slate-500">Generate with the local LLM, review, edit, approve, test-send (tasks §21–§23, §31)</p>
      </div>

      {error && <ErrorNote message={error} />}
      {note && <SuccessNote message={note} />}

      <Card title="Generate new content">
        <form onSubmit={generate} className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          <Field label="Topic *">
            <input className={inputClass} value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="SQL Window Functions" required />
          </Field>
          <Field label="Audience">
            <input className={inputClass} value={audience} onChange={(e) => setAudience(e.target.value)} />
          </Field>
          <Field label="Content type">
            <select className={inputClass} value={contentType} onChange={(e) => setContentType(e.target.value)}>
              {CONTENT_TYPES.map((t) => <option key={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Tone">
            <input className={inputClass} value={tone} onChange={(e) => setTone(e.target.value)} />
          </Field>
          <Field label="Language">
            <input className={inputClass} value={language} onChange={(e) => setLanguage(e.target.value)} />
          </Field>
          <div className="flex items-end gap-3">
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={bypassDuplicate} onChange={(e) => setBypassDuplicate(e.target.checked)} />
              Allow repeat topic
            </label>
            <Button type="submit" loading={generating} className="ml-auto">
              {generating ? 'Generating… (~1 min)' : '✨ Generate content'}
            </Button>
          </div>
        </form>
        {groups.length > 0 && (
          <div className="mt-3 max-w-xs">
            <Field label="Test group (for test sends only — never all groups)">
              <select className={inputClass} value={testTarget} onChange={(e) => setTestTarget(e.target.value)}>
                <option value="">— select a group —</option>
                {groups.map((g) => <option key={g.chatId} value={g.chatId}>{g.name}</option>)}
              </select>
            </Field>
          </div>
        )}
      </Card>

      <Card title={`Content history (${items?.length ?? '…'})`}>
        {!items && <Spinner />}
        {items?.length === 0 && <p className="text-sm text-slate-500">Nothing yet — generate your first message above.</p>}
        <div className="space-y-3">
          {items?.map((item) => (
            <div key={item.id} className="rounded-lg ring-1 ring-slate-200">
              <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-3 py-2 text-xs text-slate-500">
                <span className="font-semibold text-slate-700">#{item.id}</span>
                <span className="font-medium text-slate-700">{item.topic}</span>
                <span>· {item.content_type}</span>
                <span>· {item.model}</span>
                <span>· {item.generated_at}</span>
                <StatusBadge
                  ok={item.status === 'approved' ? true : item.status === 'flagged' || item.status === 'discarded' ? false : null}
                  label={item.status}
                />
                {item.approved ? <StatusBadge ok={true} label="approved" /> : null}
                <div className="ml-auto flex gap-1.5">
                  <Button variant="ghost" className="!px-2 !py-1" onClick={() => { setEditing(item); setEditText(item.content) }}>Edit</Button>
                  {item.status === 'draft' && <Button variant="ghost" className="!px-2 !py-1" onClick={() => approve(item.id)}>Approve</Button>}
                  <Button variant="ghost" className="!px-2 !py-1" onClick={() => sendTest(item)}>Send test</Button>
                  <Button variant="ghost" className="!px-2 !py-1" onClick={() => regenerate(item.id)}>Regenerate</Button>
                  <Button variant="ghost" className="!px-2 !py-1 !text-red-600" onClick={() => discard(item.id)}>Discard</Button>
                </div>
              </div>
              {editing?.id === item.id ? (
                <div className="space-y-2 p-3">
                  <textarea className={`${inputClass} min-h-40 font-mono text-xs`} value={editText} onChange={(e) => setEditText(e.target.value)} />
                  <div className="flex gap-2">
                    <Button onClick={saveEdit}>Save</Button>
                    <Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <pre className="thin-scroll max-h-64 overflow-auto whitespace-pre-wrap px-3 py-2 text-sm text-slate-800">{item.content}</pre>
              )}
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}
