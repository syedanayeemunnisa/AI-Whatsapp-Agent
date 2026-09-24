'use strict';

const express = require('express');
const authService = require('../services/auth-service');
const db = require('../db');
const { asyncWrap, AppError } = require('../util');
const { requireAuth, rateLimit } = require('../middleware/auth');
const { audit, fromReq, ACTIONS } = require('../services/auditService');

const router = express.Router();

const loginLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 10, scope: 'login' });

// GET /api/auth/status — public: has any account been created? (drives first-run UI)
router.get('/status', (req, res) => {
  const count = db.get().prepare('SELECT COUNT(*) AS c FROM users').get().c;
  res.json({ bootstrapped: count > 0 });
});

// POST /api/auth/login — returns JWT (task §8)
router.post(
  '/login',
  loginLimiter,
  asyncWrap(async (req, res) => {
    const { email, password } = req.body || {};
    try {
      const result = authService.login({ email, password });
      audit({ ...fromReq(req), action: ACTIONS.LOGIN, email: result.user?.email ?? email, detail: { userId: result.user?.id } });
      res.json(result);
    } catch (err) {
      audit({ ...fromReq(req), action: ACTIONS.LOGIN_FAILED, email, detail: { reason: err.message } });
      throw err;
    }
  })
);

// GET /api/auth/me — current user (used by the dashboard on load)
router.get('/me', requireAuth, (req, res) => {
  const row = db.get().prepare('SELECT id, name, email, role, created_at FROM users WHERE id = ?').get(req.user.sub);
  if (!row) throw new AppError(401, 'UNAUTHORIZED', 'User no longer exists.');
  res.json({ user: row });
});

// POST /api/auth/bootstrap — create the FIRST admin account only (no auth).
// Disabled once any user exists — prevents open sign-up on a deployed instance.
router.post(
  '/bootstrap',
  loginLimiter,
  asyncWrap(async (req, res) => {
    const { name, email, password } = req.body || {};
    const count = db.get().prepare('SELECT COUNT(*) AS c FROM users').get().c;
    if (count > 0) {
      throw new AppError(409, 'ALREADY_BOOTSTRAPPED', 'An admin account already exists. Log in instead.');
    }
    if (typeof name !== 'string' || !name.trim() || typeof email !== 'string' || !email.includes('@')) {
      throw new AppError(400, 'INVALID_INPUT', 'name and a valid email are required.');
    }
    if (typeof password !== 'string' || password.length < 8) {
      throw new AppError(400, 'WEAK_PASSWORD', 'Password must be at least 8 characters.');
    }
    const info = db
      .get()
      .prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
      .run(name.trim(), email.trim().toLowerCase(), authService.hashPassword(password), 'admin');
    audit({ ...fromReq(req), action: ACTIONS.BOOTSTRAP, email, detail: { userId: Number(info.lastInsertRowid) } });
    res.status(201).json({ id: Number(info.lastInsertRowid), message: 'Admin created. You can now log in.' });
  })
);

module.exports = router;
