-- Phase 4: AI agent hardening (task §53)
-- Automatic topic selection + rotation, weekly calendar, audience prompts,
-- extended AI validation rules.

-- Strictness for the extended AI-output validator: 'normal' (default) | 'strict'
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('validation_strictness', 'normal');
