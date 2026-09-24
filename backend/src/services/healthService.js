'use strict';

/**
 * Aggregated system health (task document §44):
 * Backend / Database / Ollama / AI Model / WhatsApp / Scheduler.
 */

const config = require('../config');
const db = require('../db');
const ollamaService = require('./ollamaService');
const waClient = require('../whatsapp/client');
const scheduler = require('../scheduler');

const startedAt = Date.now();

async function snapshot() {
  const [ollamaStatus] = await Promise.allSettled([ollamaService.checkStatus()]);

  const ollama = ollamaStatus.status === 'fulfilled'
    ? ollamaStatus.value
    : { ok: false, error: String(ollamaStatus.reason) };

  // Database check
  let database = { ok: false, error: 'not connected' };
  try {
    const d = db.get();
    const counts = d
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM generated_content) AS content,
           (SELECT COUNT(*) FROM message_logs) AS logs,
           (SELECT COUNT(*) FROM settings) AS settings`
      )
      .get();
    database = { ok: true, path: config.sqlitePath, counts };
  } catch (err) {
    database = { ok: false, error: err.message };
  }

  // Model availability (only meaningful when Ollama is up)
  let model = { name: config.ollama.model, ok: false, available: false };
  if (ollama.ok && !config.mockLlm) {
    try {
      model.available = await ollamaService.isModelAvailable(config.ollama.model);
      model.ok = model.available;
      if (!model.available) {
        model.hint = `Run: ollama pull ${config.ollama.model}`;
      }
    } catch (err) {
      model.error = err.message;
    }
  } else if (config.mockLlm) {
    model = { name: 'mock', ok: true, available: true, mock: true };
  }

  const backendOk = true;
  const overallOk = database.ok && ollama.ok && model.available;    // Real component status — both ship in this build (Phase 2/3 done).
    let whatsapp = { status: 'disconnected', phase: 2 };
    let schedulerStatus = { status: 'stopped', phase: 3 };
    try {
      whatsapp = { status: waClient.currentState().status, phase: 2 };
      schedulerStatus = { ...scheduler.getStatus(), status: scheduler.getStatus().status, phase: 3 };
    } catch {
      /* components not ready yet — keep defaults */
    }
    return {
    status: overallOk ? 'ok' : 'degraded',
    backend: {
      ok: backendOk,
      env: config.env,
      uptimeSec: Math.round((Date.now() - startedAt) / 1000),
      mockLlm: config.mockLlm,
    },
    database,
    ollama: { ...ollama, url: config.ollama.url },
    model,
    whatsapp,
    scheduler: schedulerStatus,
    checkedAt: new Date().toISOString(),
  };
}

module.exports = { snapshot };
