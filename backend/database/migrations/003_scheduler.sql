-- Phase 3: scheduler state + retry bookkeeping

-- Track when each schedule last fired. `last_fired_key` is "YYYY-MM-DDTHH:MM"
-- (local time of the slot that was fired) — one fire per slot, restart-safe.
ALTER TABLE schedules ADD COLUMN last_fired_key TEXT;
ALTER TABLE schedules ADD COLUMN last_fired_at TEXT;
-- 0=Sun … 6=Sat; NULL means every day (daily schedule)
ALTER TABLE schedules ADD COLUMN day_of_week INTEGER;

-- Retries: a failed send gets a next attempt time; the scheduler retries due rows.
ALTER TABLE message_logs ADD COLUMN next_retry_at TEXT;

CREATE INDEX IF NOT EXISTS idx_schedules_enabled ON schedules(enabled, posting_time);
CREATE INDEX IF NOT EXISTS idx_logs_retry ON message_logs(status, next_retry_at);

-- Seed: retry tuning (task §32/§33: capped retries, no runaway loops)
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('max_send_retries', '3'),
  ('retry_backoff_seconds', '120');
