# AI-Powered WhatsApp Content Automation System

Local LLM (Ollama) + whatsapp-web.js automation with a Cloudflare-hosted React dashboard.

**Current status: Phase 5 — production hardening complete. All phases (1–5) done: full automation, AI agent hardening, backups, audit trail, autostart.**

- 📄 Proposal: [`docs/PROPOSAL.md`](docs/PROPOSAL.md) · 🛠 Operations: [`docs/OPERATIONS.md`](docs/OPERATIONS.md) · 🚀 Deploy guide: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) · 🖼 Diagrams: [`docs/architecture/`](docs/architecture/)
- 🔌 API quick-reference: [`backend/poc.http`](backend/poc.http)

## Quickstart

Prerequisites: Node.js 20+, [Ollama](https://ollama.com) running, `ollama pull qwen3:8b`.

### 1. Backend (local server, port 4000)

```bash
cd backend
npm install
cp .env.example .env   # JWT_SECRET is auto-generated on first run if missing
npm start
```

First run: create the admin account (UI does this automatically, or):
`POST /api/auth/bootstrap {"name","email","password"}`

### 2. Dashboard (local dev, port 5173)

```bash
cd frontend
npm install
npm run dev          # → http://localhost:5173  (proxies /api to :4000)
```

### Local links

| What | URL |
|---|---|
| **Dashboard (UI)** | http://localhost:5173 |
| API health | http://localhost:4000/api/health |
| Liveness ping | http://localhost:4000/api/health/ping |

## What works today

- **Login** — JWT auth, bootstrap-first-admin flow, protected routes (task §8)
- **Dashboard** — live health: backend / DB / Ollama / model / WhatsApp / scheduler (task §44)
- **WhatsApp page** — QR connect, session persistence, disconnect, live group detection (tasks §11–§13)
- **Groups** — detect from WhatsApp, configure category/audience/time/frequency (task §14)
- **Content** — generate with qwen3:8b (~60–90 s on CPU), edit (never blocked), approve, regenerate, discard, duplicate-prevention with override (tasks §18–§25, §46)
- **Test send** — to ONE explicitly chosen group, rate-limited, emergency-stop aware (task §31)
- **Schedules** — CRUD + timeline (cron trigger ships in Phase 3) (task §27)
- **Logs** — delivery log with filters and error reasons (task §32)
- **Settings** — automation mode, rate limits, emergency stop toggle (tasks §29, §40–§42)

## Notes

- SQLite + WhatsApp sessions live in `%LOCALAPPDATA%\ai-whatsapp-agent\` — deliberately **outside OneDrive** (sync corrupts them).
- `MOCK_LLM=true` in backend `.env` tests the pipeline without Ollama.
- Deploying the dashboard to Cloudflare Pages + tunnel: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## Troubleshooting

- **"The browser is already running for …wwebjs_auth\session" on Connect** — a leftover headless Chrome holds the profile lock. The backend now kills it and retries automatically; if it ever fails, run `powershell -File scripts/kill-wa-chrome.ps1` and click Reconnect again.
- **`getChats()` throws cryptic `r: r` (groups empty / Internal server error)** — upstream library bug [wwebjs#201845](https://github.com/wwebjs/whatsapp-web.js/issues/201845): WhatsApp Web renamed message-id `_serialized` → `$1`. Fixed via `patches/whatsapp-web.js+1.34.7.patch` (auto-applied by `patch-package` on `npm install`). After updating the library, re-generate the patch. When the fix ships upstream (PR #201850), delete the patch.
- **After any WhatsApp client code change, restart the backend and click Reconnect** — the injected page code is only refreshed on a new session.

## Phases

1. **Phase 1 — Local POC** ✅ — Express + Ollama + content pipeline
2. **Phase 2 — Web application** ✅ — dashboard + auth + WhatsApp service
3. **Phase 3 — Automation** ✅ — node-cron scheduler, retries, auto mode, live scheduler status
4. **Phase 4 — AI agent** ✅ — topic rotation, weekly calendar, audience prompts, validation rules, weekly schedules
5. **Phase 5 — Hardening** ✅ — audit trail, daily DB backups, rate limits, autostart scripts, operations manual
