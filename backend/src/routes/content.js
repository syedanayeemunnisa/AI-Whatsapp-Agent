'use strict';

const express = require('express');
const db = require('../db');
const agent = require('../agent');
const { AppError, asyncWrap, isValidTopic } = require('../util');
const { rateLimit } = require('../middleware/auth');
const { audit, fromReq, ACTIONS } = require('../services/auditService');

const router = express.Router();

// Content generation burns ~30s of local CPU — cap bursts (Phase 5 §54).
const generateLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 20, scope: 'generate' });

/**
 * POST /api/content/generate
 * body: { topic, groupId?, audience?, contentType?, tone?, language?, model?, temperature?, maxTokens?, bypassDuplicate? }
 */
router.post('/generate', generateLimiter, asyncWrap(async (req, res) => {
  const b = req.body || {};
  if (!isValidTopic(b.topic)) {
    throw new AppError(400, 'INVALID_TOPIC', 'Provide a topic between 2 and 200 characters.');
  }

  const duplicate = agent.isDuplicate(String(b.topic).trim(), b.groupId ?? null);
  if (duplicate.duplicate && !b.bypassDuplicate) {
    throw new AppError(409, 'DUPLICATE_TOPIC', 'This topic was generated recently for this group.', duplicate);
  }

  const record = await agent.generateForBrief({
    topic: String(b.topic).trim(),
    groupId: b.groupId ?? null,
    audience: b.audience,
    contentType: b.contentType,
    tone: b.tone,
    language: b.language,
    model: b.model,
    temperature: b.temperature,
    maxTokens: b.maxTokens,
  });
  audit({ ...fromReq(req), action: ACTIONS.CONTENT_GENERATE, detail: { topic: String(b.topic).trim(), contentId: record.id, status: record.status } });
  res.status(201).json(record);
}));

/**
 * POST /api/content/:id/regenerate — same brief, new generation.
 * Marks the old record 'superseded' so history stays honest.
 */
router.post('/:id/regenerate', asyncWrap(async (req, res) => {
  const d = db.get();
  const old = d.prepare('SELECT * FROM generated_content WHERE id = ?').get(req.params.id);
  if (!old) throw new AppError(404, 'NOT_FOUND', `Content ${req.params.id} not found.`);

  const record = await agent.generateForBrief({
    topic: old.topic,
    groupId: old.group_id,
    audience: old.audience || undefined,
    contentType: old.content_type,
    tone: old.tone,
    language: old.language,
    model: undefined, // use configured default
  });

  d.prepare(`UPDATE generated_content SET status = 'superseded' WHERE id = ?`).run(old.id);
  res.status(201).json({ ...record, replacesId: old.id });
}));

// POST /api/content/:id/approve (manual approval flow)
router.post('/:id/approve', asyncWrap(async (req, res) => {
  res.json(agent.approveContent(Number(req.params.id)));
}));

// GET /api/content?status=&groupId=&limit=&offset=
router.get('/', asyncWrap(async (req, res) => {
  const d = db.get();
  const { status, groupId } = req.query;
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const offset = Math.max(Number(req.query.offset) || 0, 0);

  const clauses = [];
  const params = [];
  if (status) { clauses.push('status = ?'); params.push(status); }
  if (groupId) { clauses.push('group_id = ?'); params.push(groupId); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const rows = d
    .prepare(`SELECT * FROM generated_content ${where} ORDER BY generated_at DESC, id DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset);
  const total = d.prepare(`SELECT COUNT(*) AS c FROM generated_content ${where}`).get(...params).c;

  res.json({ total, limit, offset, items: rows });
}));

// GET /api/content/:id
router.get('/:id', asyncWrap(async (req, res) => {
  const row = db.get().prepare('SELECT * FROM generated_content WHERE id = ?').get(req.params.id);
  if (!row) throw new AppError(404, 'NOT_FOUND', `Content ${req.params.id} not found.`);
  res.json(row);
}));

/**
 * PUT /api/content/:id — user edit (task §22: editing must never be blocked).
 * Editing moves a flagged record back to draft and clears approval.
 */
router.put('/:id', asyncWrap(async (req, res) => {
  const d = db.get();
  const row = d.prepare('SELECT * FROM generated_content WHERE id = ?').get(req.params.id);
  if (!row) throw new AppError(404, 'NOT_FOUND', `Content ${req.params.id} not found.`);

  const content = req.body?.content;
  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new AppError(400, 'INVALID_CONTENT', 'Field "content" must be a non-empty string.');
  }

  d.prepare('UPDATE generated_content SET content = ?, approved = 0, status = ? WHERE id = ?')
    .run(content, row.status === 'flagged' ? 'draft' : row.status, req.params.id);

  res.json({ id: Number(req.params.id), status: 'updated' });
}));

// DELETE /api/content/:id — soft delete (discarded)
router.delete('/:id', asyncWrap(async (req, res) => {
  const d = db.get();
  const row = d.prepare('SELECT id FROM generated_content WHERE id = ?').get(req.params.id);
  if (!row) throw new AppError(404, 'NOT_FOUND', `Content ${req.params.id} not found.`);
  d.prepare(`UPDATE generated_content SET status = 'discarded' WHERE id = ?`).run(req.params.id);
  res.json({ id: Number(req.params.id), status: 'discarded' });
}));

module.exports = router;
