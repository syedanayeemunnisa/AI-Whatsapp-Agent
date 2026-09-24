'use strict';

/**
 * Weekly content calendar (Phase 4, task §53).
 * Projects enabled schedules onto a Mon–Sun grid for the coming week and
 * previews which topic each slot would use (read-only — no last_used_at writes).
 */

const db = require('../db');
const topicSelector = require('../agent/topicSelector');

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function nextDateOnOrAfter(dayOfWeek, from = new Date()) {
  const d = new Date(from);
  const delta = (dayOfWeek - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + delta);
  return d;
}

/**
 * @param {{ weeksAhead?: number }} [opts]
 * @returns {{ weekStart: string, days: Array<{ date: string, day: string, slots: Array<object> }> }}
 */
function weekCalendar({ weeksAhead = 0 } = {}) {
  const rows = db
    .get()
    .prepare(
      `SELECT s.*, g.group_name, g.category FROM schedules s
       LEFT JOIN whatsapp_groups g ON g.id = s.group_id
       WHERE s.enabled = 1
       ORDER BY s.posting_time`
    )
    .all();

  // Week starts Monday.
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() + weeksAhead * 7 - ((now.getDay() + 6) % 7));
  weekStart.setHours(0, 0, 0, 0);

  const days = [];
  for (let i = 0; i < 7; i += 1) {
    const date = new Date(weekStart);
    date.setDate(weekStart.getDate() + i);
    const slots = [];
    for (const s of rows) {
      if (s.day_of_week != null && s.day_of_week !== date.getDay()) continue;
      const picked = topicSelector.pickTopic({ ...s, group_id: s.group_id });
      slots.push({
        scheduleId: s.id,
        time: s.posting_time,
        group: s.group_name ?? `group #${s.group_id}`,
        contentType: s.content_type,
        topic: picked.topic,
        topicSource: picked.source,
      });
    }
    days.push({
      date: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
      day: DAY_NAMES[date.getDay()],
      slots,
    });
  }

  return { weekStart: weekStart.toISOString().slice(0, 10), days };
}

module.exports = { weekCalendar, nextDateOnOrAfter, DAY_NAMES };
