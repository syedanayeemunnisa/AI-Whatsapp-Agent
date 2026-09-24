'use strict';

/**
 * Automation scheduler (Phase 3, task §27/§32/§33):
 * - one node-cron tick per minute
 * - due schedules computed from SQLite → survives server restarts
 * - fire-once per slot via `last_fired_key` (written BEFORE doing work)
 * - generates content with the AI agent (dedupe-aware, rotating topics)
 * - enforces automation_mode: 'automatic' sends, 'manual_approval' leaves drafts
 * - rate limits (hourly cap, min delay, jitter) enforced in whatsapp/messaging
 * - failed sends retried with capped exponential backoff via message_logs
 */

const cron = require('node-cron');
const db = require('../db');
const logger = require('../logger');
const agent = require('../agent');
const messaging = require('../whatsapp/messaging');
const waClient = require('../whatsapp/client');
const topicSelector = require('../agent/topicSelector');

// How late past a slot we still fire after downtime (restart catch-up)
const CATCHUP_WINDOW_MIN = 120;
const MAX_RETRIES_PER_PASS = 5;

const state = {
  running: false, // cron scheduled
  ticking: false, // a tick is executing
  startedAt: null,
  lastTickAt: null,
  lastTickSummary: null,
  tickCount: 0,
  jobsRun: 0,
  lastError: null,
  task: null,
};

// ── Settings helpers (reuse messaging's accessor) ──────────────────────

const getSetting = (key, fallback) => messaging.getSetting(key, fallback);

// ── Time helpers (all local time) ──────────────────────────────────────

function localHHMM(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

function dateKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Unique key for a fired slot — "YYYY-MM-DDTHH:MM" */
function fireKey(d = new Date()) {
  return `${dateKey(d)}T${localHHMM(d)}`;
}

/** Is this schedule due in the tick covering `now`? */
function isDue(schedule, now) {
  if (schedule.day_of_week != null && schedule.day_of_week !== now.getDay()) return false;
  const hhmm = localHHMM(now);
  if (schedule.posting_time === hhmm) return true;

  // Catch-up: server was down over the slot (same day, within window, not fired today).
  // last_fired_key is "YYYY-MM-DDTHH:MM" — the fired slot is only on the same day, so
  // "fired today" means the key STARTS WITH today's date (not !== dateKey, which never matched).
  if (schedule.posting_time < hhmm && !String(schedule.last_fired_key || '').startsWith(dateKey(now))) {
    const [h, m] = String(schedule.posting_time).split(':').map(Number);
    const slotMin = h * 60 + m;
    const nowMin = now.getHours() * 60 + now.getMinutes();
    return nowMin - slotMin <= CATCHUP_WINDOW_MIN;
  }
  return false;
}

/** Fire-once marker — MUST be called before doing the work. */
function markFired(scheduleId, now) {
  db.get()
    .prepare(
      `UPDATE schedules SET last_fired_key = ?, last_fired_at = datetime('now'), updated_at = datetime('now')
       WHERE id = ?`
    )
    .run(fireKey(now), scheduleId);
}

// ── Content topic selection — Phase 4 automatic selector (category-aware LRU rotation) ─

// ── Logging + retry bookkeeping ────────────────────────────────────────

function addLog({ groupId, contentId = null, status, error = null, retryCount = 0, nextRetryAt = null, scheduledAt = null }) {
  const sentAt = status === 'sent' ? new Date().toISOString() : null;
  const info = db
    .get()
    .prepare(
      `INSERT INTO message_logs (group_id, content_id, scheduled_at, sent_at, status, error_message, retry_count, next_retry_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(groupId, contentId, scheduledAt, sentAt, status, error, retryCount, nextRetryAt);
  return Number(info.lastInsertRowid);
}

function backoffMs(retryCount) {
  const base = (Number(getSetting('retry_backoff_seconds', '120')) || 120) * 1000;
  return Math.min(base * 2 ** Math.max(retryCount - 1, 0), 10 * 60 * 1000); // cap 10 min
}

// ── Job: generate (and maybe send) for one schedule ────────────────────

async function runScheduleJob(schedule, { scheduledAt = null } = {}) {
  const groupId = schedule.group_id;
  const group = db.get().prepare('SELECT * FROM whatsapp_groups WHERE id = ?').get(groupId);
  if (!group) {
    addLog({ groupId, status: 'failed', error: 'group_not_configured', scheduledAt });
    return { status: 'failed', reason: 'group_not_configured' };
  }

  const picked = topicSelector.pickTopic(schedule);
  const topic = picked.topic;
  if (!topic) {
    addLog({ groupId, status: 'failed', error: 'no_topic_available', scheduledAt });
    return { status: 'failed', reason: 'no_topic_available' };
  }

  // Duplicate prevention first — never spend CPU regenerating repeats (task §25)
  const dup = agent.isDuplicate(topic, groupId);
  if (dup.duplicate) {
    addLog({ groupId, status: 'skipped_duplicate', error: `topic used recently (content ${dup.previousId})`, scheduledAt });
    return { status: 'skipped_duplicate', previousId: dup.previousId };
  }

  let record = await agent.generateForBrief({
    topic,
    groupId,
    contentType: schedule.content_type || 'Daily Tip',
    audience: group.audience || undefined,
  });

  // Phase 4: one regeneration retry when the validator flags the output.
  if (record.status === 'flagged') {
    logger.warn({ scheduleId: schedule.id, contentId: record.id, issues: record.validation?.issues }, 'Content flagged — regenerating once');
    record = await agent.generateForBrief({
      topic,
      groupId,
      contentType: schedule.content_type || 'Daily Tip',
      audience: group.audience || undefined,
    });
  }

  if (record.status === 'flagged') {
    addLog({ groupId, contentId: record.id, status: 'failed', error: 'validation_flagged', scheduledAt });
    return { status: 'failed', reason: 'validation_flagged', contentId: record.id };
  }

  // Mode enforcement (task §21): manual approval keeps drafts for the review queue
  const mode = String(getSetting('automation_mode', 'manual_approval'));
  if (mode !== 'automatic') {
    addLog({ groupId, contentId: record.id, status: 'pending_approval', scheduledAt });
    logger.info({ scheduleId: schedule.id, contentId: record.id }, 'Content generated — waiting for manual approval');
    return { status: 'pending_approval', contentId: record.id };
  }

  // Automatic mode → send now. Rate limits, delays and emergency stop are
  // enforced inside messaging.sendToGroup (task §40).
  try {
    const result = await messaging.sendToGroup(group.whatsapp_group_id, record.content);
    addLog({ groupId, contentId: record.id, status: 'sent', scheduledAt });
    logger.info({ scheduleId: schedule.id, contentId: record.id, messageId: result.messageId }, 'Scheduled message sent');
    return { status: 'sent', contentId: record.id, messageId: result.messageId };
  } catch (err) {
    const retryCount = 1;
    const nextRetryAt = new Date(Date.now() + backoffMs(retryCount)).toISOString();
    addLog({ groupId, contentId: record.id, status: 'failed', error: err.message, retryCount, nextRetryAt, scheduledAt });
    return { status: 'failed', error: err.message, contentId: record.id, retryAt: nextRetryAt };
  }
}

// ── Retry pass: failed sends with capped backoff (task §32) ────────────

async function processRetries() {
  const maxRetries = Number(getSetting('max_send_retries', '3')) || 3;
  const rows = db
    .get()
    .prepare(
      `SELECT l.id, l.group_id, l.content_id, l.retry_count, g.whatsapp_group_id
       FROM message_logs l
       LEFT JOIN whatsapp_groups g ON g.id = l.group_id
       WHERE l.status = 'failed' AND l.retry_count < ? AND l.next_retry_at IS NOT NULL
         AND l.next_retry_at <= ? AND l.content_id IS NOT NULL AND g.id IS NOT NULL
       ORDER BY l.next_retry_at
       LIMIT ?`
    )
    .all(maxRetries, new Date().toISOString(), MAX_RETRIES_PER_PASS);

  for (const row of rows) {
    const auto = String(getSetting('automation_mode', 'manual_approval')) === 'automatic';
    // In automatic mode retry even unapproved content; in manual mode wait for approval.
    const content = db
      .get()
      .prepare(`SELECT content FROM generated_content WHERE id = ? ${auto ? '' : 'AND approved = 1'}`)
      .get(row.content_id);
    if (!content) {
      db.get()
        .prepare(`UPDATE message_logs SET next_retry_at = NULL, error_message = COALESCE(error_message || ' | ', '') || 'waiting for approval' WHERE id = ?`)
        .run(row.id);
      continue;
    }
    try {
      await messaging.sendToGroup(row.whatsapp_group_id, content.content);
      db.get()
        .prepare(
          `UPDATE message_logs SET status = 'sent', sent_at = ?, next_retry_at = NULL, retry_count = retry_count + 1, error_message = NULL WHERE id = ?`
        )
        .run(new Date().toISOString(), row.id);
      logger.info({ logId: row.id, contentId: row.content_id }, 'Retry send succeeded');
    } catch (err) {
      if (err && err.code === 'EMERGENCY_STOP') break; // stop everything, keep retry for later
      const rc = row.retry_count + 1;
      const giveUp = rc >= maxRetries;
      db.get()
        .prepare(`UPDATE message_logs SET retry_count = ?, next_retry_at = ?, error_message = ? WHERE id = ?`)
        .run(
          rc,
          giveUp ? null : new Date(Date.now() + backoffMs(rc)).toISOString(),
          giveUp ? `${err.message} | gave up after ${maxRetries} retries` : err.message,
          row.id
        );
      logger.warn({ logId: row.id, retryCount: rc, giveUp, err: err.message }, 'Retry send failed');
    }
  }
  return rows.length;
}

// ── The tick ────────────────────────────────────────────────────────────

async function tick() {
  if (state.ticking) return; // previous tick still generating — skip
  state.ticking = true;
  const now = new Date();
  try {
    const summary = { due: 0, results: [], retries: 0, skipped: null };
    state.tickCount += 1;
    state.lastTickAt = now.toISOString();

    if (String(getSetting('emergency_stop', 'false')).toLowerCase() === 'true') {
      summary.skipped = 'emergency_stop';
      state.lastTickSummary = summary;
      return;
    }

    const schedules = db.get().prepare('SELECT * FROM schedules WHERE enabled = 1').all();
    const due = schedules.filter((s) => isDue(s, now));
    summary.due = due.length;

    const whatsappUp = waClient.currentState().connected;
    if (!whatsappUp && due.length) {
      summary.skipped = 'whatsapp_not_connected';
      logger.warn({ due: due.length }, 'Schedules due but WhatsApp is not connected — will retry via catch-up');
    }

    const maxPerCycle = Number(getSetting('max_groups_per_cycle', '3')) || 3;
    for (const schedule of due.slice(0, whatsappUp ? maxPerCycle : 0)) {
      markFired(schedule.id, now); // fire-once BEFORE the slow work
      try {
        const result = await runScheduleJob(schedule, { scheduledAt: `${dateKey(now)}T${schedule.posting_time}` });
        state.jobsRun += 1;
        summary.results.push({ scheduleId: schedule.id, group: schedule.group_id, ...result });
      } catch (err) {
        state.lastError = err.message;
        logger.error({ err, scheduleId: schedule.id }, 'Scheduled job failed');
        summary.results.push({ scheduleId: schedule.id, status: 'failed', reason: err.message });
      }
    }

    if (whatsappUp) summary.retries = await processRetries();

    state.lastTickSummary = summary;
    if (due.length || summary.retries) {
      logger.info({ due: due.length, results: summary.results, retries: summary.retries }, 'Scheduler tick');
    }
  } catch (err) {
    state.lastError = err.message;
    logger.error({ err }, 'Scheduler tick failed');
  } finally {
    state.ticking = false;
  }
}

// ── Lifecycle ───────────────────────────────────────────────────────────

function start() {
  if (state.running) return getStatus();
  state.task = cron.schedule('* * * * *', () => void tick(), { runOnInit: true });
  state.running = true;
  state.startedAt = new Date().toISOString();
  logger.info('Scheduler started — checking due schedules every minute');
  return getStatus();
}

function stop() {
  if (state.task) {
    state.task.stop();
    state.task = null;
  }
  state.running = false;
  logger.info('Scheduler stopped');
  return getStatus();
}

function getStatus() {
  let activeSchedules = 0;
  let pendingApproval = 0;
  let pendingRetries = 0;
  try {
    activeSchedules = db.get().prepare('SELECT COUNT(*) c FROM schedules WHERE enabled = 1').get().c;
    pendingApproval = db.get().prepare("SELECT COUNT(*) c FROM message_logs WHERE status = 'pending_approval'").get().c;
    pendingRetries = db.get().prepare("SELECT COUNT(*) c FROM message_logs WHERE status = 'failed' AND next_retry_at IS NOT NULL").get().c;
  } catch {
    /* DB not ready yet */
  }
  return {
    status: state.running ? 'running' : 'stopped',
    ticking: state.ticking,
    startedAt: state.startedAt,
    lastTickAt: state.lastTickAt,
    tickCount: state.tickCount,
    jobsRun: state.jobsRun,
    activeSchedules,
    pendingApproval,
    pendingRetries,
    lastTickSummary: state.lastTickSummary,
    lastError: state.lastError,
  };
}

module.exports = { start, stop, tick, getStatus, isDue, runScheduleJob };
