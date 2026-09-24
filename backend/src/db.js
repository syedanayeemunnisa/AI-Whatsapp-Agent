'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');
const logger = require('./logger');

let db;

function initDb() {
  if (db) return db;

  fs.mkdirSync(path.dirname(config.sqlitePath), { recursive: true });
  db = new DatabaseSync(config.sqlitePath);

  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');

  migrate(db);
  logger.info({ path: config.sqlitePath }, 'SQLite ready');
  return db;
}

function migrate(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const dir = path.join(__dirname, '..', 'database', 'migrations');
  const applied = new Set(
    database.prepare('SELECT name FROM _migrations').all().map((r) => r.name)
  );
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    database.exec('BEGIN');
    try {
      database.exec(sql);
      database
        .prepare('INSERT INTO _migrations (name) VALUES (?)')
        .run(file);
      database.exec('COMMIT');
      logger.info({ migration: file }, 'Applied migration');
    } catch (err) {
      database.exec('ROLLBACK');
      throw new Error(`Migration ${file} failed: ${err.message}`);
    }
  }
}

function getDb() {
  if (!db) initDb();
  return db;
}

function closeDb() {
  if (db) {
    db.close();
    db = undefined;
  }
}

module.exports = { initDb, getDb, get: getDb, closeDb };
