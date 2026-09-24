import { useCallback, useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { api } from '../lib/api'
import { Button, Card, ErrorNote, Spinner, StatusBadge, SuccessNote } from '../components/ui'

interface WaState {
  connected: boolean
  status: string
  phone: string | null
  pushname: string | null
  connectedAt: string | null
  hasQr: boolean
  sessionSaved: boolean
  lastError: string | null
}

interface WaGroup {
  chatId: string
  name: string
  participantCount: number | null
}

export default function WhatsAppPage() {
  const [state, setState] = useState<WaState | null>(null)
  const [qr, setQr] = useState('')
  const [groups, setGroups] = useState<WaGroup[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [qrDataUrl, setQrDataUrl] = useState('')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const loadStatus = useCallback(async () => {
    try {
      const s = await api.get<WaState>('/api/whatsapp/status')
      setState(s)
      return s
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load WhatsApp status')
      return null
    }
  }, [])

  useEffect(() => {
    loadStatus()
  }, [loadStatus])

  // Poll for QR while connecting
  useEffect(() => {
    if (state?.status === 'qr_pending' || state?.status === 'initializing' || state?.status === 'authenticating') {
      pollRef.current = setInterval(async () => {
        const s = await loadStatus()
        if (!s) return
        if (s.hasQr) {
          // WhatsApp rotates the QR every ~20s — always follow the latest one
          try {
            const q = await api.get<{ qr: string; generatedAt: string }>('/api/whatsapp/qr')
            setQr((prev) => (prev === q.qr ? prev : q.qr))
          } catch { /* QR not ready yet */ }
        }
        if (s.connected) {
          setQr('')
          if (pollRef.current) clearInterval(pollRef.current)
        }
      }, 2000)
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [state?.status, loadStatus])

  async function connect() {
    setBusy(true)
    setError('')
    setNote('Starting WhatsApp Web session… this opens a hidden browser; the QR appears below when ready.')
    try {
      await api.post('/api/whatsapp/connect', {}, 120000)
      await loadStatus()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connect failed')
      setNote('')
    } finally {
      setBusy(false)
    }
  }

  async function disconnect() {
    setBusy(true)
    try {
      await api.post('/api/whatsapp/disconnect', { logout: false })
      setQr('')
      setGroups(null)
      setNote('Disconnected. The saved session was kept — reconnect without re-scanning.')
      await loadStatus()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Disconnect failed')
    } finally {
      setBusy(false)
    }
  }

  async function loadGroups() {
    setBusy(true)
    setError('')
    try {
      const res = await api.get<{ groups: WaGroup[] }>('/api/whatsapp/groups')
      setGroups(res.groups)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load groups — is WhatsApp connected?')
    } finally {
      setBusy(false)
    }
  }

  const connecting = state && ['initializing', 'qr_pending', 'authenticating'].includes(state.status)

  // Render the QR locally — never send the login secret to an external service
  useEffect(() => {
    if (!qr) {
      setQrDataUrl('')
      return
    }
    let cancelled = false
    QRCode.toDataURL(qr, { width: 240, margin: 1 })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url)
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl('')
      })
    return () => {
      cancelled = true
    }
  }, [qr])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">WhatsApp Connection</h1>
        <p className="text-sm text-slate-500">Authenticate once via QR; the session persists across restarts (task §12)</p>
      </div>

      {error && <ErrorNote message={error} />}
      {note && <SuccessNote message={note} />}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Status">
          {state ? (
            <div className="space-y-3 text-sm">
              <div className="flex items-center gap-2">
                <StatusBadge ok={state.connected} label={state.status} />
                {state.sessionSaved && <StatusBadge ok={true} label="session saved" />}
              </div>
              {state.phone && (
                <div className="text-slate-600">
                  Phone: <span className="font-medium text-slate-900">{state.phone}</span>
                  {state.pushname ? ` · ${state.pushname}` : ''}
                </div>
              )}
              {state.connectedAt && (
                <div className="text-slate-500">Connected at: {new Date(state.connectedAt).toLocaleString()}</div>
              )}
              {state.lastError && <div className="text-xs text-red-600">{state.lastError}</div>}
              <div className="flex gap-2 pt-2">
                {!state.connected && (
                  <Button onClick={connect} loading={busy} disabled={Boolean(connecting)}>
                    {connecting ? 'Connecting…' : state.sessionSaved ? 'Reconnect' : 'Connect WhatsApp'}
                  </Button>
                )}
                {state.connected && (
                  <>
                    <Button variant="secondary" onClick={loadGroups} loading={busy}>Refresh groups</Button>
                    <Button variant="secondary" onClick={disconnect} loading={busy}>Disconnect</Button>
                  </>
                )}
              </div>
            </div>
          ) : (
            <Spinner />
          )}
        </Card>

        <Card title="QR Code">
          {qr ? (
            <div className="space-y-3">
              <img
                src={qrDataUrl}
                alt="WhatsApp QR code"
                className="mx-auto rounded-lg ring-1 ring-slate-200"
              />
              <p className="text-center text-xs text-slate-500">
                WhatsApp → Linked devices → Link a device. The QR refreshes automatically.
              </p>
            </div>
          ) : state?.connected ? (
            <p className="text-sm text-green-700">✅ Connected — no QR needed.</p>
          ) : connecting ? (
            <Spinner label="Waiting for QR from WhatsApp Web…" />
          ) : (
            <p className="text-sm text-slate-500">Click “Connect WhatsApp” to get a QR code.</p>
          )}
        </Card>
      </div>

      <Card title={`Groups detected (${groups?.length ?? '—'})`}>
        {!groups && <p className="text-sm text-slate-500">Connect WhatsApp, then refresh to list your groups.</p>}
        {groups && groups.length === 0 && <p className="text-sm text-slate-500">No group chats found for this account.</p>}
        {groups && groups.length > 0 && (
          <ul className="divide-y divide-slate-100">
            {groups.map((g) => (
              <li key={g.chatId} className="flex items-center justify-between py-2 text-sm">
                <span className="font-medium text-slate-800">{g.name}</span>
                <span className="text-xs text-slate-400">
                  {g.participantCount != null ? `${g.participantCount} members · ` : ''}
                  <span className="font-mono">{g.chatId}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
