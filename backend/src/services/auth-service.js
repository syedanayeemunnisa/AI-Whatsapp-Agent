'use strict';

/**
 * Authentication service (task §8): scrypt password hashing (node:crypto),
 * HMAC-SHA256 JWT signing/verification (zero external dependencies).
 */

const crypto = require('node:crypto');
const config = require('../config');
const db = require('../db');
const { AppError } = require('../util');

const TOKEN_TTL_SECONDS = 12 * 60 * 60; // 12h

// ── Passwords (scrypt) ────────────────────────────────────────────────

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  try {
    const [scheme, salt, hash] = String(stored).split(':');
    if (scheme !== 'scrypt' || !salt || !hash) return false;
    const candidate = crypto.scryptSync(password, salt, 64);
    const expected = Buffer.from(hash, 'hex');
    return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
  } catch {
    return false;
  }
}

// ── JWT (HS256) ───────────────────────────────────────────────────────

function secret() {
  const s = config.jwtSecret;
  if (!s) {
    throw new AppError(500, 'NO_JWT_SECRET', 'JWT_SECRET is not configured on the server.', {
      hint: 'Add JWT_SECRET to backend/.env (any long random string) and restart.',
    });
  }
  return s;
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');

function signToken(payload) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const body = b64url(JSON.stringify({ ...payload, iat: now, exp: now + TOKEN_TTL_SECONDS }));
  const sig = crypto.createHmac('sha256', secret()).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function verifyToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const expected = crypto.createHmac('sha256', secret()).update(`${header}.${body}`).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

// ── Login ─────────────────────────────────────────────────────────────

function login({ email, password }) {
  if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
    throw new AppError(400, 'INVALID_CREDENTIALS', 'Email and password are required.');
  }

  const row = db
    .get()
    .prepare('SELECT id, name, email, password_hash, role FROM users WHERE email = ?')
    .get(email.trim().toLowerCase());

  // Constant-ish response regardless of which part failed (no user enumeration)
  if (!row || !verifyPassword(password, row.password_hash)) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
  }

  const token = signToken({ sub: row.id, name: row.name, email: row.email, role: row.role });
  return {
    token,
    user: { id: row.id, name: row.name, email: row.email, role: row.role },
    expiresInSeconds: TOKEN_TTL_SECONDS,
  };
}

function verifyAuthHeader(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  return verifyToken(authHeader.slice(7));
}

module.exports = { hashPassword, verifyPassword, signToken, verifyToken, login, verifyAuthHeader };
