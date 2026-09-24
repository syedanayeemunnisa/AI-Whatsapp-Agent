'use strict';

const express = require('express');
const scheduler = require('../scheduler');
const { asyncWrap } = require('../util');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// GET /api/scheduler — live scheduler status (tick counts, last results, retries)
router.get('/', asyncWrap(async (_req, res) => {
  res.json(scheduler.getStatus());
}));

// POST /api/scheduler/tick — force a tick now (useful for testing schedules)
router.post('/tick', asyncWrap(async (_req, res) => {
  await scheduler.tick();
  res.json(scheduler.getStatus());
}));

module.exports = router;
