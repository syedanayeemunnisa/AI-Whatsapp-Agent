'use strict';

const express = require('express');
const db = require('../db');
const { asyncWrap, AppError } = require('../util');
const { requireAuth } = require('../middleware/auth');
const { audit, fromReq, ACTIONS } = require('../services/auditService');

const router = express.Router();
router.use(requireAuth);

// GET /api/groups — configured groups
router.get('/', asyncWrap(async (req, res) => {
  const rows = db.get().prepare('SELECT * FROM whatsapp_groups ORDER BY group_name').all();
  res.json({ count: rows.length, groups: rows });
}));

// POST /api/groups — configure a detected group (upsert by whatsapp_group_id)
router.post('/', asyncWrap(async (req, res) => {
  const { groupName, chatId, category, audience, postingTime, frequency } = req.body || {};
  if (!groupName || !chatId) {
    throw new AppError(400, 'INVALID_INPUT', 'groupName and chatId are required.');
  }
  const info = db
    .get()
    .prepare(
      `INSERT INTO whatsapp_groups (group_name, whatsapp_group_id, category, audience, posting_time, frequency)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(whatsapp_group_id) DO UPDATE SET
         group_name = excluded.group_name,
         category = excluded.category,
         audience = excluded.audience,
         posting_time = excluded.posting_time,
         frequency = excluded.frequency,
         updated_at = datetime('now')`
    )
    .run(groupName, chatId, category ?? null, audience ?? null, postingTime ?? null, frequency ?? 'daily');
  audit({ ...fromReq(req), action: ACTIONS.GROUP_CREATE, detail: { groupName, chatId } });
  res.status(201).json({ id: Number(info.lastInsertRowid), configured: true });
}));

// PUT /api/groups/:id
router.put('/:id', asyncWrap(async (req, res) => {
  const allowed = ['group_name', 'category', 'audience', 'posting_time', 'frequency', 'enabled'];
  const updates = [];
  const params = [];
  for (const key of allowed) {
    if (req.body?.[key] !== undefined) {
      updates.push(`${key} = ?`);
      params.push(req.body[key]);
    }
  }
  if (!updates.length) throw new AppError(400, 'NO_CHANGES', 'Nothing to update.');
  updates.push(`updated_at = datetime('now')`);
  params.push(req.params.id);
  const info = db.get().prepare(`UPDATE whatsapp_groups SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  if (info.changes === 0) throw new AppError(404, 'NOT_FOUND', `Group ${req.params.id} not found.`);
  audit({ ...fromReq(req), action: ACTIONS.GROUP_UPDATE, detail: { id: Number(req.params.id), changes: req.body } });
  res.json({ id: Number(req.params.id), updated: true });
}));

// DELETE /api/groups/:id
router.delete('/:id', asyncWrap(async (req, res) => {
  const info = db.get().prepare('DELETE FROM whatsapp_groups WHERE id = ?').run(req.params.id);
  if (info.changes === 0) throw new AppError(404, 'NOT_FOUND', `Group ${req.params.id} not found.`);
  audit({ ...fromReq(req), action: ACTIONS.GROUP_DELETE, detail: { id: Number(req.params.id) } });
  res.json({ id: Number(req.params.id), deleted: true });
}));

module.exports = router;
