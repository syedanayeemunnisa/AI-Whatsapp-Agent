-- Default settings for the POC
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('automation_mode', 'manual'),          -- manual | automatic
  ('emergency_stop', '0'),                -- 0 = automation allowed
  ('default_model', 'qwen3:8b'),
  ('default_language', 'English'),
  ('default_tone', 'Friendly and Educational');
