-- Phase 1 schema (subset of proposal §36 needed for the POC)

CREATE TABLE IF NOT EXISTS whatsapp_groups (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  group_name        TEXT NOT NULL,
  whatsapp_group_id TEXT NOT NULL UNIQUE,
  enabled           INTEGER NOT NULL DEFAULT 1,
  category          TEXT,
  audience          TEXT,
  posting_time      TEXT,
  frequency         TEXT NOT NULL DEFAULT 'daily',
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS content_categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS content_topics (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id  INTEGER NOT NULL REFERENCES content_categories(id),
  topic        TEXT NOT NULL,
  active       INTEGER NOT NULL DEFAULT 1,
  last_used_at TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS generated_content (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id     INTEGER REFERENCES whatsapp_groups(id),
  topic        TEXT NOT NULL,
  content      TEXT NOT NULL,
  content_type TEXT NOT NULL,
  tone         TEXT,
  audience     TEXT,
  language     TEXT,
  model        TEXT NOT NULL,
  generated_at TEXT NOT NULL DEFAULT (datetime('now')),
  approved     INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'draft'
);

CREATE TABLE IF NOT EXISTS schedules (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id     INTEGER NOT NULL REFERENCES whatsapp_groups(id),
  topic        TEXT,
  content_type TEXT NOT NULL DEFAULT 'Daily Tip',
  posting_time TEXT NOT NULL,
  frequency    TEXT NOT NULL DEFAULT 'daily',
  enabled      INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS message_logs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id      INTEGER REFERENCES whatsapp_groups(id),
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

CREATE INDEX IF NOT EXISTS idx_content_group ON generated_content(group_id, generated_at);
CREATE INDEX IF NOT EXISTS idx_logs_group_time ON message_logs(group_id, sent_at);

-- Seed: default content categories (task §15)
INSERT OR IGNORE INTO content_categories (name) VALUES
  ('Data Analytics'), ('Data Science'), ('SQL'), ('Power BI'), ('Python'),
  ('Artificial Intelligence'), ('Machine Learning'), ('Generative AI'),
  ('Digital Marketing'), ('SEO'), ('Career'), ('Interview Preparation'),
  ('Technology');

-- Seed: default settings
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('automation_mode', 'manual_approval'),
  ('emergency_stop', 'false'),
  ('max_messages_per_hour', '6'),
  ('min_delay_seconds', '45'),
  ('max_groups_per_cycle', '3'),
  ('default_model', 'qwen3:8b'),
  ('default_tone', 'Friendly and Educational'),
  ('default_language', 'English');
