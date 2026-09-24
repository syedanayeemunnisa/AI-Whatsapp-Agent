'use strict';

/**
 * Auth middleware (task §39). requireAuth gates every sensitive route;
 * a simple in-memory rate limiter protects the login route.
 */

const { verifyAuthHeader } = require('../services/auth-service');
const { AppError } = require('../util');

function requireAuth(req, res, next) {
  const payload = verifyAuthHeader(req.headers.authorization);
  if (!payload) {
    return next(new AppError(401, 'UNAUTHORIZED', 'Authentication required. Log in first.'));
  }
  req.user = payload; // { sub, name, email, role, iat, exp }
  next();
}

/** Optional: require a specific role. */
function requireRole(role) {
  return (req, res, next) => {
    if (!req.user || req.user.role !== role) {
      return next(new AppError(403, 'FORBIDDEN', `Requires role: ${role}`));
    }
    next();
  };
}

/** Tiny in-memory fixed-window rate limiter (per IP + scope). */
function rateLimit({ windowMs = 10 * 60 * 1000, max = 10, scope = 'global' } = {}) {
  const hits = new Map(); // key → { count, windowStart }
  return (req, res, next) => {
    const key = `${scope}:${req.ip}`;
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || now - entry.windowStart > windowMs) {
      hits.set(key, { count: 1, windowStart: now });
      return next();
    }
    entry.count += 1;
    if (entry.count > max) {
      const retryAfterSec = Math.ceil((entry.windowStart + windowMs - now) / 1000);
      res.setHeader('Retry-After', String(retryAfterSec));
      return next(new AppError(429, 'RATE_LIMITED', `Too many attempts. Retry in ${retryAfterSec}s.`));
    }
    next();
  };
}

module.exports = { requireAuth, requireRole, rateLimit };
