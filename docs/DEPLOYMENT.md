# Phase 2 Deployment — Cloudflare Pages + Secure Tunnel

## 1. Deploy the dashboard to Cloudflare Pages

```bash
cd frontend
npm run build                       # local dev build (API = same origin / proxy)
npx wrangler login                  # one-time
npx wrangler pages deploy dist      # → https://<project>.pages.dev
```

The `wrangler.toml` + `public/_redirects` (SPA fallback) are already in place.

## 2. Expose the local backend through Cloudflare Tunnel

```bash
# one-time
cloudflared tunnel login
cloudflared tunnel create ai-whatsapp-agent
cloudflared tunnel route dns ai-whatsapp-agent api.yourdomain.com   # or use a free trycloudflare URL for the demo
```

`~/.cloudflared/config.yml`:

```yaml
tunnel: ai-whatsapp-agent
credentials-file: C:\Users\<you>\.cloudflared\<tunnel-id>.json
ingress:
  - hostname: api.yourdomain.com
    service: http://localhost:4000
    originRequest:
      noTLSVerify: true
  - service: http_status:404
```

Run it (install as a service for 24/7):

```bash
cloudflared tunnel run ai-whatsapp-agent
cloudflared service install
```

The tunnel is **outbound-only** — no ports opened on the router; the backend binds to 127.0.0.1.

## 3. Rebuild the frontend against the tunnel

```bash
cd frontend
VITE_API_BASE=https://api.yourdomain.com npm run build
npx wrangler pages deploy dist
```

## 4. Add the Pages origin to the backend CORS allow-list

`backend/.env`:

```
CORS_ORIGINS=http://localhost:5173,https://<project>.pages.dev
```

Restart the backend. Requests from any other origin are rejected (403) at the CORS gate.

## 5. Recommended hardening (Phase 5, or now if deploying for real use)

- **Cloudflare Access** on the API hostname (email OTP): nobody reaches the tunnel without a second factor.
- Keep `JWT_SECRET` long and private (already generated in `backend/.env`).
- WhatsApp session files stay in `%LOCALAPPDATA%\ai-whatsapp-agent\wwebjs_auth` — back them up, never commit/sync them.
- Set up `cloudflared` + backend + Ollama to auto-start (Windows: Task Scheduler or NSSM services).

## Security model recap (task §38–§40)

| Layer | Control |
|---|---|
| Edge | Cloudflare Tunnel (outbound TLS), optional Access policy |
| API | JWT auth on every sensitive route, CORS allow-list, rate-limited login |
| Data | SQLite + sessions in LOCALAPPDATA (outside OneDrive), `.env` gitignored |
| WhatsApp | Group chats only, hourly cap, min delay, emergency stop |
