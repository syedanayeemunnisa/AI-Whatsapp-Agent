'use strict';

/**
 * Database backups (Phase 5, task §54): daily consistent snapshot of the live
 * SQLite DB via `VACUUM INTO` (safe while the app keeps serving requests),
 * with simple day-based retention and a restore-time integrity check.
 */

const fs = require('node:fs');
const path = require('node:path');
const config = require('../config');
const logger = require('../logger');
const { audit, ACTIONS } = require('./auditService');

const RETENTION_DAYS = 7;

function backupDir() {
  return path.join(config.dataDir, 'backups');
}

function backupFilePath(when = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return path.join(backupDir(), `app-${when.getFullYear()}-${p(when.getMonth() + 1)}-${p(when.getDate())}.db`);
}

/** Run a snapshot now. Skips if today's snapshot already exists. */
function runBackup({ force = false } = {}) {
  const dir = backupDir();
  fs.mkdirSync(dir, { recursive: true });
  const target = backupFilePath();

  if (!force && fs.existsSync(target)) {
    return { skipped: true, file: target, reason: 'today snapshot already exists' };
  }

  const started = Date.now();
  const db = require('../db').get();
  db.prepare(`VACUUM INTO ?`).run(target);
  const size = fs.statSync(target).size;
  const ms = Date.now() - started;

  pruneOldBackups();
  logger.info({ file: target, sizeBytes: size, ms }, 'Database backup created');
  audit({ action: ACTIONS.BACKUP, detail: { file: path.basename(target), sizeBytes: size, ms } });

  return { skipped: false, file: target, sizeBytes: size, ms };
}

/** Delete snapshots older than RETENTION_DAYS. */
function pruneOldBackups() {
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  try {
    for (const f of fs.readdirSync(backupDir())) {
      const full = path.join(backupDir(), f);
      if (/^app-\d{4}-\d{2}-\d{2}\.db$/.test(f) && fs.statSync(full).mtimeMs < cutoff) {
        fs.unlinkSync(full);
        logger.info({ file: f }, 'Old backup pruned');
      }
    }
  } catch (err) {
    logger.warn({ err: err.message }, 'Backup pruning failed (ignored)');
  }
}

/** List existing snapshots (newest first). */
function listBackups() {
  try {
    return fs
      .readdirSync(backupDir())
      .filter((f) => /^app-\d{4}-\d{2}-\d{2}\.db$/.test(f))
      .map((f) => {
        const full = path.join(backupDir(), f);
        return { file: f, sizeBytes: fs.statSync(full).size, modifiedAt: fs.statSync(full).mtime.toISOString() };
      })
      .sort((a, b) => b.file.localeCompare(a.file));
  } catch {
    return [];
  }
}

/** Integrity check usable against any snapshot or the live DB. */
function integrityCheck(file = config.sqlitePath) {
  const db = require('node:sqlite');
  const handle = new db.DatabaseSync(file, { readOnly: true });
  try {
    const row = handle.prepare('PRAGMA integrity_check').get();
    const counts = handle
      .prepare(
        `SELECT (SELECT COUNT(*) FROM schedules) AS schedules,
                (SELECT COUNT(*) FROM generated_content) AS content,
                (SELECT COUNT(*) FROM message_logs) AS logs`
      )
      .get();
    return { file: path.basename(file), result: row.integrity_check || row['integrity_check'], counts };
  } finally {
    handle.close();
  }
}

module.exports = { runBackup, listBackups, integrityCheck, backupDir };
