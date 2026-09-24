'use strict';

/**
 * AI Agent (task §45): prompt building → generation → validation → persistence.
 * Single agent for MVP; no multi-agent complexity in Phase 1.
 */

const db = require('../db');
const logger = require('../logger');
const { AppError } = require('../util');
const ollamaService = require('../services/ollamaService');
const { buildContentPrompt, SYSTEM_PROMPT } = require('./prompts/contentPrompt');
const { validateContent } = require('./validator/contentValidator');
const { formatForWhatsApp } = require('./formatter/whatsappFormatter');
const { getSetting } = require('../whatsapp/messaging');

/** Recent distinct topics for a group (or globally) for duplicate avoidance. */
function recentTopics({ groupId = null, limit = 10 } = {}) {
  const d = db.get();
  const rows = groupId
    ? d.prepare(`
        SELECT topic FROM generated_content
        WHERE group_id = ? AND status != 'discarded'
        ORDER BY generated_at DESC LIMIT ?`)
        .all(groupId, limit)
    : d.prepare(`
        SELECT topic FROM generated_content
        WHERE status != 'discarded'
        ORDER BY generated_at DESC LIMIT ?`)
        .all(limit);
  return [...new Set(rows.map((r) => r.topic))];
}

/** Exact/near duplicate check (task §25 MVP: same topic for same group recently). */
function isDuplicate(topic, groupId = null) {
  const d = db.get();
  const row = groupId
    ? d.prepare(`
        SELECT id, generated_at FROM generated_content
        WHERE topic = ? AND group_id = ? AND status != 'discarded'
          AND generated_at > datetime('now', '-7 days')
        LIMIT 1`)
        .get(topic, groupId)
    : d.prepare(`
        SELECT id, generated_at FROM generated_content
        WHERE topic = ? AND status != 'discarded'
          AND generated_at > datetime('now', '-7 days')
        LIMIT 1`)
        .get(topic);
  return row ? { duplicate: true, previousId: row.id, generatedAt: row.generated_at } : { duplicate: false };
}

/**
 * Generate content for a brief. Persists to generated_content.
 * @param {object} brief { topic, groupId?, audience?, contentType?, tone?, language?, model?, temperature?, maxTokens? }
 */
async function generateForBrief(brief) {
  const {
    topic,
    groupId = null,
    audience = 'Students',
    contentType = 'Daily Tip',
    tone = 'Friendly and Educational',
    language = 'English',
    model,
    temperature,
    maxTokens,
  } = brief;

  const dup = isDuplicate(topic, groupId);
  const recent = recentTopics({ groupId });
  const prompt = buildContentPrompt({ topic, audience, contentType, tone, language, recentTopics: recent });

  logger.info({ topic, contentType, audience }, 'AI agent generating content');

  const result = await ollamaService.generate({
    prompt,
    system: SYSTEM_PROMPT,
    model,
    temperature,
    maxTokens,
    meta: { topic, audience, contentType },
  });

  const raw = result.content;
  const formatted = formatForWhatsApp(raw);
  // Phase 4: extended validation rules; strictness comes from settings.
  const strict = String(getSetting('validation_strictness', 'normal')).toLowerCase() === 'strict';
  const validation = validateContent(formatted, { strict });

  const d = db.get();
  const insert = d.prepare(`
    INSERT INTO generated_content
      (group_id, topic, content, content_type, tone, audience, language, model, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const info = insert.run(
    groupId,
    topic,
    formatted,
    contentType,
    tone,
    audience,
    language,
    result.model,
    validation.ok ? 'draft' : 'flagged'
  );

  const record = {
    id: Number(info.lastInsertRowid),
    groupId,
    topic,
    contentType,
    audience,
    tone,
    language,
    content: formatted,
    model: result.model,
    status: validation.ok ? 'draft' : 'flagged',
    validation,
    duplicateWarning: dup.duplicate
      ? { ...dup, message: `This topic was generated recently (previous id ${dup.previousId}).` }
      : null,
    meta: { evalCount: result.evalCount, durationMs: result.durationMs, mock: Boolean(result.mock) },
  };

  logger.info({ id: record.id, status: record.status, durationMs: result.durationMs }, 'Content generated');
  return record;
}

/** Mark content approved (manual approval flow, task §29). */
function approveContent(id) {
  const d = db.get();
  const row = d.prepare('SELECT id, status, content FROM generated_content WHERE id = ?').get(id);
  if (!row) throw new AppError(404, 'NOT_FOUND', `Content ${id} not found.`);

  const validation = validateContent(row.content);
  if (!validation.ok) {
    throw new AppError(422, 'VALIDATION_FAILED', 'Content failed validation and cannot be approved.', {
      issues: validation.issues,
    });
  }

  d.prepare(`UPDATE generated_content SET approved = 1, status = 'approved' WHERE id = ?`).run(id);
  return { id, status: 'approved' };
}

module.exports = { generateForBrief, approveContent, recentTopics, isDuplicate };
