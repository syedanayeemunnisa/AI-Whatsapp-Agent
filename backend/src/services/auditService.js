'use strict';

/**
 * Audit logging (Phase 5, task §54): append-only record of security-relevant
 * actions — logins, setting changes, schedule/group/content mutations,
 * WhatsApp connect/disconnect, emergency stop. Never throws into request
 * paths: audit failures must not break the action being audited.
 */

const db = require('../db');
const logger = require('../logger');

const ACTIONS = {
  LOGIN: 'auth.login',
  LOGIN_FAILED: 'auth.login_failed',
  LOGOUT: 'auth.logout',
  BOOTSTRAP: 'auth.bootstrap',
  SETTINGS_UPDATE: 'settings.update',
  EMERGENCY_STOP: 'automation.emergency_stop',
  EMERGENCY_RESUME: 'automation.emergency_resume',
  SCHEDULE_CREATE: 'schedule.create',
  SCHEDULE_UPDATE: 'schedule.update',
  SCHEDULE_DELETE: 'schedule.delete',
  GROUP_CREATE: 'group.create',
  GROUP_UPDATE: 'group.update',
  GROUP_DELETE: 'group.delete',
  CONTENT_GENERATE: 'content.generate',
  CONTENT_UPDATE: 'content.update',
  CONTENT_DELETE: 'content.delete',
  CONTENT_APPROVE: 'content.approve',
  WHATSAPP_CONNECT: 'whatsapp.connect',
  WHATSAPP_DISCONNECT: 'whatsapp.disconnect',
  BACKUP: 'system.backup',
};

/**
 * @param {{ req?: object, userId?: number|null, email?: string|null, action: string, detail?: object }} p
 */
function audit({ req, userId = null, email = null, action, detail = null }) {
  try {
    const ip = req?.ip ?? null;
    db.get()
      .prepare('INSERT INTO audit_logs (user_id, user_email, action, detail, ip) VALUES (?, ?, ?, ?, ?)')
      .run(userId, email, action, detail ? JSON.stringify(detail).slice(0, 1000) : null, ip);
  } catch (err) {
    logger.warn({ err: err.message, action }, 'Audit write failed (ignored)');
  }
}

/** Express helper: audit(action, detailFn) inside an authenticated route. */
function fromReq(req) {
  return {
    userId: req?.user?.sub ?? null,
    email: req?.user?.email ?? null,
    req,
  };
}

function recent({ limit = 50, action = null } = {}) {
  const clauses = [];
  const params = [];
  if (action) {
    clauses.push('action = ?');
    params.push(action);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return db
    .get()
    .prepare(
      `SELECT id, user_email, action, detail, ip, created_at
       FROM audit_logs ${where}
       ORDER BY id DESC LIMIT ?`
    )
    .all(...params, Math.min(Number(limit) || 50, 200));
}

module.exports = { audit, fromReq, recent, ACTIONS };
