'use strict';

const express = require('express');
const db = require('../db');
const { asyncWrap } = require('../util');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// GET /api/logs?status=&groupId=&limit=&offset= — message delivery logs (task §32)
router.get('/', asyncWrap(async (req, res) => {
  const { status, groupId } = req.query;
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const offset = Math.max(Number(req.query.offset) || 0, 0);

  const clauses = [];
  const params = [];
  if (status) {
    clauses.push('l.status = ?');
    params.push(status);
  }
  if (groupId) {
    clauses.push('l.group_id = ?');
    params.push(groupId);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const rows = db
    .get()
    .prepare(
      `SELECT l.*, g.group_name, c.topic
       FROM message_logs l
       LEFT JOIN whatsapp_groups g ON g.id = l.group_id
       LEFT JOIN generated_content c ON c.id = l.content_id
       ${where}
       ORDER BY COALESCE(l.sent_at, l.scheduled_at) DESC, l.id DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset);

  const total = db
    .get()
    .prepare(`SELECT COUNT(*) AS c FROM message_logs l ${where}`)
    .get(...params).c;

  res.json({ total, limit, offset, logs: rows });
}));

module.exports = router;
