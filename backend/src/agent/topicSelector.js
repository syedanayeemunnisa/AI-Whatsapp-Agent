'use strict';

/**
 * Automatic topic selection + rotation (Phase 4, task §53).
 * Strategy per schedule:
 *   1. schedule.topic fixed            → use it (dedupe still applies downstream)
 *   2. topics from schedule's category → rotate least-recently-used first
 *   3. any active topic                → rotate
 *   4. empty pool                      → content_type as prompt seed (agent picks the angle)
 * Rotation always skips topics the target group saw recently (7-day dedupe window).
 */

const db = require('../db');

const DEDUPE_DAYS = 7;

/** Topics this group already received in the dedupe window. */
function recentlyUsedByGroup(groupId) {
  if (!groupId) return new Set();
  const rows = db
    .get()
    .prepare(
      `SELECT DISTINCT topic FROM generated_content
       WHERE group_id = ? AND status != 'discarded' AND status != 'superseded'
         AND generated_at > datetime('now', ?)`
    )
    .all(groupId, `-${DEDUPE_DAYS} days`);
  return new Set(rows.map((r) => String(r.topic).toLowerCase()));
}

/**
 * Pick the next topic for a schedule.
 * @param {object} schedule row (topic, content_type, group_id, optional category)
 * @returns {{ topic: string|null, source: 'fixed'|'category'|'pool'|'fallback' }}
 */
function pickTopic(schedule) {
  if (schedule.topic) return { topic: schedule.topic, source: 'fixed' };

  const seen = recentlyUsedByGroup(schedule.group_id);
  const base = db
    .get()
    .prepare(
      `SELECT t.id, t.topic FROM content_topics t
       LEFT JOIN content_categories c ON c.id = t.category_id
       WHERE t.active = 1 AND (? IS NULL OR c.name = ?)
       ORDER BY COALESCE(t.last_used_at, '') ASC, RANDOM()
       LIMIT 12`
    )
    .all(schedule.category ?? null, schedule.category ?? null);

  const fresh = base.find((r) => !seen.has(String(r.topic).toLowerCase()));
  if (fresh) {
    db.get().prepare(`UPDATE content_topics SET last_used_at = datetime('now') WHERE id = ?`).run(fresh.id);
    return { topic: fresh.topic, source: schedule.category ? 'category' : 'pool' };
  }

  // Pool exhausted for this group (everything used in the window) — rotate anyway,
  // least-recently-used first.
  if (base.length) {
    db.get().prepare(`UPDATE content_topics SET last_used_at = datetime('now') WHERE id = ?`).run(base[0].id);
    return { topic: base[0].topic, source: schedule.category ? 'category' : 'pool' };
  }

  return { topic: schedule.content_type || 'Daily Tip', source: 'fallback' };
}

/** Read-only preview for the calendar/UI: what would each schedule get today? */
function previewFor(schedules) {
  return schedules.map((s) => ({ scheduleId: s.id, ...pickTopic({ ...s, group_id: s.group_id }) }));
}

module.exports = { pickTopic, previewFor, recentlyUsedByGroup, DEDUPE_DAYS };
