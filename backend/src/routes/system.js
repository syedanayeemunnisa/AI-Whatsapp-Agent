'use strict';

const express = require('express');
const backupService = require('../services/backupService');
const auditService = require('../services/auditService');
const { asyncWrap } = require('../util');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireRole('admin'));

// GET /api/system/audit — recent admin-activity trail
router.get('/audit', asyncWrap(async (req, res) => {
  res.json({ count: Number(req.query.limit) || 50, items: auditService.recent({ limit: req.query.limit, action: req.query.action }) });
}));

// GET /api/system/backups — snapshot list + integrity of the live DB
router.get('/backups', asyncWrap(async (_req, res) => {
  res.json({ backups: backupService.listBackups(), liveIntegrity: backupService.integrityCheck() });
}));

// POST /api/system/backup — snapshot now (idempotent per day; body { force } overrides)
router.post('/backup', asyncWrap(async (req, res) => {
  res.json(backupService.runBackup({ force: Boolean(req.body?.force) }));
}));

module.exports = router;
