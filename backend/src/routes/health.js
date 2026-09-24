'use strict';

const express = require('express');
const healthService = require('../services/healthService');
const { asyncWrap } = require('../util');

const router = express.Router();

// GET /api/health — full status snapshot (task §44)
router.get('/', asyncWrap(async (_req, res) => {
  const snapshot = await healthService.snapshot();
  res.status(200).json(snapshot);
}));

// GET /api/health/ping — cheap liveness probe (no Ollama/DB round-trips)
router.get('/ping', (_req, res) => {
  res.json({ ok: true, uptimeSec: process.uptime() });
});

module.exports = router;
