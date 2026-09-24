'use strict';

/**
 * Messaging with safety controls (task §31, §40):
 * - group chats only
 * - min delay between sends (randomized ±20% to look human)
 * - hourly cap
 * - emergency stop check (reads `emergency_stop` from settings)
 */

const db = require('../db');
const config = require('../config');
const logger = require('../logger');
const { resolveGroupChat } = require('./groups');
const waClient = require('./client');
const { AppError } = require('../util');

let lastSendAt = 0;
let sendTimestamps = []; // for hourly cap

/**
 * Puppeteer errors that mean the underlying browser page is gone even though
 * the client still reports "connected" (zombie session). On these we reset
 * the client and reconnect once, instead of burning retries forever.
 */
function isFatalSessionError(err) {
  return /detached frame|execution context destroyed|target closed|session closed|page closed|protocol error/i.test(
    String(err?.message || '')
  );
}

function getSetting(key, fallback) {
  try {
    const row = db.get().prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? row.value : fallback;
  } catch {
    return fallback;
  }
}

function setSetting(key, value) {
  db.get()
    .prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
    )
    .run(key, String(value));
}

function assertEmergencyStopOff() {
  if (String(getSetting('emergency_stop', 'false')).toLowerCase() === 'true') {
    throw new AppError(423, 'EMERGENCY_STOP', 'Emergency stop is ACTIVE — all sending is disabled.');
  }
}

async function throttle() {
  // hourly cap
  const maxPerHour = Number(getSetting('max_messages_per_hour', '6')) || 6;
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  sendTimestamps = sendTimestamps.filter((t) => t > oneHourAgo);
  if (sendTimestamps.length >= maxPerHour) {
    throw new AppError(429, 'RATE_LIMIT_HOURLY', `Hourly cap reached (${maxPerHour}/hour). Try later.`);
  }

  // min delay with ±20% jitter
  const base = config.whatsapp.minSendDelayMs;
  const delay = base * (0.8 + Math.random() * 0.4);
  const since = Date.now() - lastSendAt;
  if (since < delay) {
    await new Promise((r) => setTimeout(r, delay - since));
  }
}

/**
 * Send a text message to a group. Returns { messageId, chatId, sentAt }.
 * Self-healing: if the send fails because the browser session is a zombie
 * ("detached Frame" etc.), reset the client, reconnect once and retry.
 */
async function sendToGroup(chatId, text) {
  assertEmergencyStopOff();
  if (!text || !String(text).trim()) {
    throw new AppError(400, 'EMPTY_MESSAGE', 'Message text is empty.');
  }

  try {
    return await deliver(chatId, text);
  } catch (err) {
    if (!isFatalSessionError(err)) throw err;
    logger.warn({ err: err.message }, 'WhatsApp session died mid-flight despite "connected" — reconnecting once and retrying');
    waClient.resetAfterCrash();
    await waClient.connect();
    return await deliver(chatId, text);
  }
}

async function deliver(chatId, text) {
  const chat = await resolveGroupChat(chatId); // throws WA_NOT_CONNECTED / NOT_A_GROUP
  await throttle();

  const sent = await chat.sendMessage(String(text).trim());
  lastSendAt = Date.now();
  sendTimestamps.push(lastSendAt);

  logger.info({ chatId, messageId: sent?.id?._serialized ?? null }, 'WhatsApp message sent');
  return { messageId: sent?.id?._serialized ?? null, chatId, sentAt: new Date().toISOString() };
}

async function emergencyStop(active) {
  setSetting('emergency_stop', active ? 'true' : 'false');
  return { emergencyStop: Boolean(active) };
}

module.exports = { sendToGroup, emergencyStop, assertEmergencyStopOff, getSetting, setSetting };
