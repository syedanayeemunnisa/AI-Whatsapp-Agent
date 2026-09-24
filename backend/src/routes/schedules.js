'use strict';

const express = require('express');
const db = require('../db');
const { asyncWrap, AppError } = require('../util');
const { requireAuth } = require('../middleware/auth');
const { audit, fromReq, ACTIONS } = require('../services/auditService');

const router = express.Router();
router.use(requireAuth);

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const FREQ_RE = /^(daily|weekly)$/;
const DOW_RE = /^[0-6]$/;

// GET /api/schedules
router.get('/', asyncWrap(async (req, res) => {
  const rows = db
    .get()
    .prepare(
      `SELECT s.*, g.group_name FROM schedules s
       LEFT JOIN whatsapp_groups g ON g.id = s.group_id
       ORDER BY s.posting_time`
    )
    .all();
  res.json({ count: rows.length, schedules: rows });
}));

// POST /api/schedules — { groupId, topic?, contentType, postingTime, frequency?, dayOfWeek? }
router.post('/', asyncWrap(async (req, res) => {
  const { groupId, topic, contentType = 'Daily Tip', postingTime, frequency = 'daily', dayOfWeek } = req.body || {};
  if (!groupId || !TIME_RE.test(String(postingTime || ''))) {
    throw new AppError(400, 'INVALID_INPUT', 'groupId and postingTime (HH:MM, 24h) are required.');
  }
  if (!FREQ_RE.test(String(frequency))) {
    throw new AppError(400, 'INVALID_INPUT', 'frequency must be daily or weekly.');
  }
  if (frequency === 'weekly' && !DOW_RE.test(String(dayOfWeek))) {
    throw new AppError(400, 'INVALID_INPUT', 'dayOfWeek (0=Sun … 6=Sat) is required for weekly schedules.');
  }
  const group = db.get().prepare('SELECT id FROM whatsapp_groups WHERE id = ?').get(groupId);
  if (!group) throw new AppError(404, 'GROUP_NOT_FOUND', `Group ${groupId} not configured.`);

  const info = db
    .get()
    .prepare(
      `INSERT INTO schedules (group_id, topic, content_type, posting_time, frequency, day_of_week)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(groupId, topic ?? null, contentType, postingTime, frequency, frequency === 'weekly' ? Number(dayOfWeek) : null);
  audit({ ...fromReq(req), action: ACTIONS.SCHEDULE_CREATE, detail: { id: Number(info.lastInsertRowid), groupId, postingTime, frequency } });
  res.status(201).json({ id: Number(info.lastInsertRowid), created: true });
}));

// PUT /api/schedules/:id
router.put('/:id', asyncWrap(async (req, res) => {
  const allowed = ['topic', 'content_type', 'posting_time', 'frequency', 'enabled', 'day_of_week'];
  const updates = [];
  const params = [];
  for (const key of allowed) {
    if (req.body?.[key] !== undefined) {
      if (key === 'posting_time' && !TIME_RE.test(String(req.body[key]))) {
        throw new AppError(400, 'INVALID_TIME', 'postingTime must be HH:MM (24h).');
      }
      if (key === 'frequency' && !FREQ_RE.test(String(req.body[key]))) {
        throw new AppError(400, 'INVALID_INPUT', 'frequency must be daily or weekly.');
      }
      if (key === 'day_of_week' && req.body[key] !== null && !DOW_RE.test(String(req.body[key]))) {
        throw new AppError(400, 'INVALID_INPUT', 'day_of_week must be 0 (Sun) … 6 (Sat) or null.');
      }
      updates.push(`${key} = ?`);
      params.push(req.body[key]);
    }
  }
  if (!updates.length) throw new AppError(400, 'NO_CHANGES', 'Nothing to update.');
  updates.push(`updated_at = datetime('now')`);
  params.push(req.params.id);
  const info = db.get().prepare(`UPDATE schedules SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  if (info.changes === 0) throw new AppError(404, 'NOT_FOUND', `Schedule ${req.params.id} not found.`);
  audit({ ...fromReq(req), action: ACTIONS.SCHEDULE_UPDATE, detail: { id: Number(req.params.id), changes: req.body } });
  res.json({ id: Number(req.params.id), updated: true });
}));

// DELETE /api/schedules/:id
router.delete('/:id', asyncWrap(async (req, res) => {
  const info = db.get().prepare('DELETE FROM schedules WHERE id = ?').run(req.params.id);
  if (info.changes === 0) throw new AppError(404, 'NOT_FOUND', `Schedule ${req.params.id} not found.`);
  audit({ ...fromReq(req), action: ACTIONS.SCHEDULE_DELETE, detail: { id: Number(req.params.id) } });
  res.json({ id: Number(req.params.id), deleted: true });
}));

module.exports = router;
