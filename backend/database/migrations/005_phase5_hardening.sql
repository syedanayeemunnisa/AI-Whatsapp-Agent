-- Phase 5: production hardening (task §54, §58)

-- Audit trail: who did what, when, from where. Append-only (no updates/deletes
-- from the app; retention handled by the backup job, not by pruning).
CREATE TABLE IF NOT EXISTS audit_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER,
  user_email TEXT,
  action     TEXT NOT NULL,            -- e.g. auth.login, settings.update, schedule.create
  detail     TEXT,                     -- small JSON blob, no secrets
  ip         TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action, created_at);
