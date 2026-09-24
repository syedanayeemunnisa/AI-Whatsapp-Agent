'use strict';

const express = require('express');
const waClient = require('../whatsapp/client');
const waGroups = require('../whatsapp/groups');
const waMessaging = require('../whatsapp/messaging');
const db = require('../db');
const { asyncWrap, AppError } = require('../util');
const { requireAuth, rateLimit } = require('../middleware/auth');
const { audit, fromReq, ACTIONS } = require('../services/auditService');

const router = express.Router();
router.use(requireAuth);

// GET /api/whatsapp/status
router.get('/status', (req, res) => {
  res.json(waClient.currentState());
});

// POST /api/whatsapp/connect — starts the client; QR arrives via /qr polling
router.post('/connect', rateLimit({ windowMs: 5 * 60 * 1000, max: 6, scope: 'wa-connect' }), asyncWrap(async (req, res) => {
  const state = await waClient.connect();
  if (state.connected) audit({ ...fromReq(req), action: ACTIONS.WHATSAPP_CONNECT, detail: { phone: state.phone } });
  res.json(state);
}));

// GET /api/whatsapp/qr — poll while status is qr_pending
router.get('/qr', (req, res) => {
  const qr = waClient.getQr();
  if (!qr) {
    throw new AppError(404, 'NO_QR', 'No QR available. Call POST /api/whatsapp/connect first.');
  }
  res.json(qr);
});

// POST /api/whatsapp/disconnect
router.post('/disconnect', asyncWrap(async (req, res) => {
  const logout = req.body?.logout !== false;
  const out = await waClient.disconnect({ logout });
  audit({ ...fromReq(req), action: ACTIONS.WHATSAPP_DISCONNECT, detail: { logout } });
  res.json(out);
}));

// GET /api/whatsapp/groups — live groups from the session (task §13)
router.get('/groups', asyncWrap(async (req, res) => {
  const groups = await waGroups.listGroups();
  res.json({ count: groups.length, groups });
}));

// POST /api/whatsapp/test — send a test message to ONE explicitly chosen group
// body: { chatId, contentId } or { chatId, text }
router.post('/test', rateLimit({ windowMs: 10 * 60 * 1000, max: 10, scope: 'wa-test' }), asyncWrap(async (req, res) => {
  const { chatId, contentId, text } = req.body || {};
  if (!chatId) throw new AppError(400, 'CHAT_ID_REQUIRED', 'chatId of the target group is required.');

  let message = text;
  let usedContentId = null;
  if (!message && contentId != null) {
    const row = db.get().prepare('SELECT id, content FROM generated_content WHERE id = ?').get(Number(contentId));
    if (!row) throw new AppError(404, 'CONTENT_NOT_FOUND', `Content ${contentId} not found.`);
    message = row.content;
    usedContentId = row.id;
  }
  if (!message) {
    throw new AppError(400, 'NOTHING_TO_SEND', 'Provide either text or contentId.');
  }

  const result = await waMessaging.sendToGroup(chatId, message);

  // log the attempt (task §32)
  db.get()
    .prepare(
      `INSERT INTO message_logs (group_id, content_id, sent_at, status, error_message, retry_count)
       VALUES ((SELECT id FROM whatsapp_groups WHERE whatsapp_group_id = ?), ?, ?, 'sent', NULL, 0)`
    )
    .run(chatId, usedContentId, result.sentAt);

  res.json({ ...result, contentId: usedContentId });
}));

// POST /api/whatsapp/stop — emergency stop on/off  body: { active: true|false }
router.post('/stop', asyncWrap(async (req, res) => {
  const active = Boolean(req.body?.active);
  res.json(await waMessaging.emergencyStop(active));
}));

module.exports = router;
