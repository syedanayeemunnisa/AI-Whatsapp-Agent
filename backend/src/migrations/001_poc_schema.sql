-- Phase 1 POC schema (subset of proposal §6; expanded in Phase 2/3)

CREATE TABLE IF NOT EXISTS generated_content (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id     INTEGER,
  topic        TEXT NOT NULL,
  content      TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'Daily Tip',
  tone         TEXT NOT NULL DEFAULT 'Friendly and Educational',
  audience     TEXT,
  language     TEXT NOT NULL DEFAULT 'English',
  model        TEXT NOT NULL,
  generated_at TEXT NOT NULL DEFAULT (datetime('now')),
  approved     INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'draft'
);

CREATE TABLE IF NOT EXISTS message_logs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  content_id    INTEGER REFERENCES generated_content(id),
  scheduled_at  TEXT,
  sent_at       TEXT,
  status        TEXT NOT NULL,
  error_message TEXT,
  retry_count   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_content_group_time ON generated_content(group_id, generated_at);
CREATE INDEX IF NOT EXISTS idx_logs_time ON message_logs(sent_at);
