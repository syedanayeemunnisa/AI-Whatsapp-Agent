# Operations Manual — AI WhatsApp Content Automation

Local-first automation: Express + SQLite + Ollama + whatsapp-web.js, React dashboard.
Everything runs on your machine; nothing leaves it except WhatsApp messages you schedule.

---

## 1. Install (fresh machine)

1. **Prerequisites**: Node.js 20+ (`node -v`), [Ollama](https://ollama.com) on PATH, a Chromium-based browser (auto-detected: Chrome → Edge → Playwright Chromium).
2. **Model**: `ollama pull qwen3:8b` (≈5 GB). On CPU-only machines expect ~26 s per post (with thinking disabled).
3. **Backend**:
   ```powershell
   cd backend
   npm install          # also applies the whatsapp-web.js patch
   Copy-Item .env.example .env   # then set JWT_SECRET (see below)
   npm start
   ```
   `JWT_SECRET`: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
4. **Dashboard**: `cd frontend && npm install && npm run dev` → http://localhost:5173
5. **First run**: the UI walks you through creating the admin account. Then WhatsApp page → **Connect** → scan QR once (session persists in `%LOCALAPPDATA%\ai-whatsapp-agent\wwebjs_auth` — treat it like a password).
6. **Groups → Detect groups** → configure category + audience per group. **Content topics**: seed the pool so "auto" schedules rotate (Content page).

### Auto-start at logon (recommended)

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1   # register
powershell -ExecutionPolicy Bypass -File scripts\remove-autostart.ps1    # undo
```

Starts Ollama and the backend automatically at Windows logon. The frontend dev server is not auto-started (open `npm run dev` when you need the UI; automation itself does not depend on it).

---

## 2. Daily operation

| Task | Where |
|---|---|
| System health (backend/DB/Ollama/model/WhatsApp/scheduler) | Dashboard |
| Connect / disconnect WhatsApp, re-scan QR | WhatsApp page |
| Create schedules (daily or weekly, 12-hour time) | Schedules page |
| See the week ahead with topic-rotation previews | Calendar page |
| Read why a send failed / succeeded | Logs page (plain-English reasons) |
| Approval mode, rate limits, validation strictness, emergency stop | Settings page |
| Admin activity trail (logins, changes, stops) | Settings page → Recent admin activity |
| Manual DB snapshot | `POST /api/system/backup` |

**Sending model:** the backend scheduler ticks every minute. A due schedule: picks a topic (fixed → category rotation → pool rotation → content-type fallback) → dedupe check (7-day window per group) → generates (~26 s) → validates (flags fabricated stats, contact info, spam; one auto-regeneration on flag) → sends in `automatic` mode (hourly cap + min delay enforced). Missed slots are caught up within 2 hours of a restart.

**Modes:** `manual_approval` (default) parks content as drafts for review; `automatic` sends directly. The red **Emergency stop** button halts all sending instantly, server-side.

---

## 3. API quick reference (all JSON; Bearer JWT except login/status)

```
POST /api/auth/bootstrap     create first admin (once)
POST /api/auth/login         → { token }
GET  /api/health             system snapshot (no auth)
GET  /api/health/ping        liveness

GET  /api/whatsapp/status    connection state
POST /api/whatsapp/connect   start client (QR via GET /api/whatsapp/qr)
POST /api/whatsapp/disconnect
GET  /api/whatsapp/groups    live group detection
POST /api/whatsapp/test      send one test message { chatId, contentId | text }

GET/POST /api/groups         configured groups
PUT/DELETE /api/groups/:id

POST /api/content/generate   { topic, groupId?, contentType?... } (rate-limited)
POST /api/content/:id/regenerate | /approve
GET/PUT/DELETE /api/content/:id

GET/POST /api/schedules      { groupId, postingTime, frequency, dayOfWeek?, topic? }
PUT/DELETE /api/schedules/:id
GET  /api/scheduler          live scheduler status
POST /api/scheduler/tick     force a tick now

GET  /api/calendar/week      weekly calendar + topic previews
GET  /api/logs?status=&groupId=

GET/PUT /api/settings        whitelisted keys only
POST /api/automation/stop | /start   emergency stop

GET  /api/system/audit       recent admin activity (admin)
GET  /api/system/backups     snapshots + live integrity check
POST /api/system/backup      snapshot now { force? }
```

Errors are always `{ "error": { "code", "message", "details?" } }`. Rate-limited routes answer `429` with `Retry-After`.

---

## 4. Database & backups

- **File**: `%LOCALAPPDATA%\ai-whatsapp-agent\app.db` (WAL mode; deliberately outside OneDrive — sync corrupts SQLite).
- **Migrations**: numbered `.sql` in `backend/database/migrations/`, auto-applied on boot, tracked in `_migrations`.
- **Tables**: `users, whatsapp_groups, content_categories, content_topics, generated_content, schedules, message_logs, settings, audit_logs, _migrations`.
- **Backups**: automatic snapshot daily at **03:30** and at boot (if today's is missing), via `VACUUM INTO` — consistent while the server runs. Kept in `%LOCALAPPDATA%\ai-whatsapp-agent\backups\app-YYYY-MM-DD.db`, **7-day retention**.
- **Restore**: stop the backend, replace `app.db` (and remove `-wal`/`-shm` siblings) with a snapshot, start the backend. Verify first with `GET /api/system/backups` → `liveIntegrity`.
- **Audit trail**: `audit_logs` records logins (incl. failures), setting changes, schedule/group/content mutations, emergency stop, WhatsApp connect/disconnect, backups. View in Settings → Recent admin activity.

---

## 5. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Dashboard "degraded", Ollama red | Ollama not running → start it (or the autostart task). Check `http://localhost:11434/api/version`. |
| Model red | `ollama pull qwen3:8b` |
| Schedules fire but nothing sends | Check Logs page for plain-English reason. Common: WhatsApp disconnected (reconnect), duplicate topic (7-day window), hourly cap reached, emergency stop active. |
| WhatsApp disconnects after backend restart | Session persists; click **Connect** on the WhatsApp page — no QR needed unless the phone unlinked the device. Auto-reconnect already retries 5× with backoff. |
| "browser is already running" on connect | Zombie Chrome holds the profile. The backend kills it and retries automatically; else `powershell -File scripts\kill-wa-chrome.ps1`. |
| Generation slow (>60 s) | CPU inference. Already optimized (`think:false`, token cap 400). Bigger win: `ollama pull qwen3:4b` and set it in Settings (~2× faster). |
| Groups list empty / cryptic `r: r` error | Upstream wwebjs bug — fixed by `patches/whatsapp-web.js+1.34.7.patch` (auto-applied on `npm install`). See README. |
| Locked out | If you forget the admin password, restore a pre-mistake DB snapshot, or delete the `users` row to re-run bootstrap. |
| 401 everywhere | JWT expired or backend restarted with a new `JWT_SECRET` — log in again. |

**Security posture:** API binds `127.0.0.1` only; CORS allow-list; JWT auth on all sensitive routes; login/generate/test-send rate-limited; secrets in `.env` (gitignored); sessions + DB under `%LOCALAPPDATA%` (gitignored); audit trail for accountability. Remote dashboard access is via Cloudflare Tunnel + Access — see `docs/DEPLOYMENT.md`.
