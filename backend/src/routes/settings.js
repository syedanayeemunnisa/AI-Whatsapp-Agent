'use strict';

const express = require('express');
const db = require('../db');
const waMessaging = require('../whatsapp/messaging');
const { asyncWrap } = require('../util');
const { requireAuth } = require('../middleware/auth');
const { audit, fromReq, ACTIONS } = require('../services/auditService');

const router = express.Router();
router.use(requireAuth);

const EDITABLE = new Set([
  'automation_mode',
  'max_messages_per_hour',
  'min_delay_seconds',
  'max_groups_per_cycle',
  'default_model',
  'default_tone',
  'default_language',
  'validation_strictness',
]);

// GET /api/settings — all settings as an object
router.get('/', (req, res) => {
  const rows = db.get().prepare('SELECT key, value FROM settings').all();
  const out = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  res.json({ settings: out });
});

// PUT /api/settings — { key: value, ... } (whitelisted keys only)
router.put('/', asyncWrap(async (req, res) => {
  const body = req.body || {};
  const updates = Object.entries(body).filter(([k]) => EDITABLE.has(k));
  if (!updates.length) {
    res.json({ updated: 0 });
    return;
  }
  const stmt = db.get().prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
  );
  for (const [k, v] of updates) stmt.run(k, String(v));
  audit({ ...fromReq(req), action: ACTIONS.SETTINGS_UPDATE, detail: Object.fromEntries(updates) });
  res.json({ updated: updates.length });
}));

// POST /api/automation/stop — emergency stop ON (task §41)
router.post('/automation/stop', asyncWrap(async (req, res) => {
  const out = await waMessaging.emergencyStop(true);
  audit({ ...fromReq(req), action: ACTIONS.EMERGENCY_STOP });
  res.json(out);
}));

// POST /api/automation/start — resume
router.post('/automation/start', asyncWrap(async (req, res) => {
  const out = await waMessaging.emergencyStop(false);
  audit({ ...fromReq(req), action: ACTIONS.EMERGENCY_RESUME });
  res.json(out);
}));

module.exports = router;
