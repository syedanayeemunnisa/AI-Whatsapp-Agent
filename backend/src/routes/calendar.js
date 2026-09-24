'use strict';

const express = require('express');
const calendarService = require('../services/calendarService');
const { asyncWrap } = require('../util');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// GET /api/calendar/week?weeksAhead=0 — Mon–Sun grid with topic previews
router.get('/week', asyncWrap(async (req, res) => {
  const weeksAhead = Math.min(Math.max(Number(req.query.weeksAhead) || 0, 0), 8);
  res.json(calendarService.weekCalendar({ weeksAhead }));
}));

module.exports = router;
