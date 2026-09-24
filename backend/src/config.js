'use strict';

require('dotenv').config();

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function bool(value, fallback = false) {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function detectBrowser() {
  const candidates = [
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright') && undefined,
  ].filter(Boolean);
  void candidates;
  const fixed = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  ];
  for (const p of fixed) {
    try {
      if (fs.existsSync(p)) return p;
    } catch { /* ignore */ }
  }
  // Latest Playwright Chromium, if present
  try {
    const pwRoot = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright');
    if (fs.existsSync(pwRoot)) {
      const dirs = fs
        .readdirSync(pwRoot)
        .filter((d) => d.startsWith('chromium-'))
        .sort()
        .reverse();
      for (const d of dirs) {
        for (const sub of ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe']) {
          const p = path.join(pwRoot, d, sub);
          if (fs.existsSync(p)) return p;
        }
      }
    }
  } catch { /* ignore */ }
  return undefined; // fall back to Puppeteer's bundled Chromium
}

const required = (name) => {
  const v = process.env[name];
  if (!v) {
    // Not fatal for the POC — log prominently and continue with the default below.
    return undefined;
  }
  return v;
};

const config = {
  env: process.env.NODE_ENV || 'development',
  port: num(process.env.PORT, 4000),
  host: process.env.HOST || '127.0.0.1',

  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  logLevel: process.env.LOG_LEVEL || 'info',

  ollama: {
    url: required('OLLAMA_URL') || 'http://localhost:11434',
    model: process.env.OLLAMA_MODEL || 'qwen3:8b',
    keepAlive: process.env.OLLAMA_KEEP_ALIVE || '30m',
    timeoutMs: num(process.env.OLLAMA_TIMEOUT_MS, 180000),
    temperature: Number(process.env.GEN_TEMPERATURE || 0.7),
    // Posts are capped at ~120 words; 400 tokens covers that with headroom.
    // (Lower cap = faster failure-free CPU generation; env can override.)
    maxTokens: num(process.env.GEN_MAX_TOKENS, 400),
  },

  // SQLite lives in %LOCALAPPDATA% by default: cloud-synced folders (OneDrive etc.)
  // cause file locks/corruption with SQLite, so runtime data must stay out of them.
  sqlitePath: process.env.SQLITE_PATH
    ? path.resolve(__dirname, '..', process.env.SQLITE_PATH)
    : path.join(
        process.env.LOCALAPPDATA || os.homedir(),
        'ai-whatsapp-agent',
        'app.db'
      ),

  mockLlm: bool(process.env.MOCK_LLM, false),

  jwtSecret: process.env.JWT_SECRET,

  // Runtime data root — LOCALAPPDATA, never OneDrive (sync corrupts sessions/DBs)
  dataDir: path.join(process.env.LOCALAPPDATA || os.homedir(), 'ai-whatsapp-agent'),
  whatsapp: {
    authDir: path.join(
      process.env.LOCALAPPDATA || os.homedir(),
      'ai-whatsapp-agent',
      'wwebjs_auth'
    ),
    minSendDelayMs: num(process.env.WA_MIN_DELAY_MS, 8000),
    sessionTimeoutMs: num(process.env.WA_SESSION_TIMEOUT_MS, 90000),
    // Puppeteer's Chromium download can fail behind proxies/AV. Point at an
    // existing Chrome/Edge/Playwright-Chromium instead (auto-detected below).
    executablePath: process.env.WA_EXECUTABLE_PATH || detectBrowser(),
  },

  // Where .env lives (used to warn if missing)
  envFile: path.resolve(__dirname, '..', '.env'),
};

if (!fs.existsSync(config.envFile) && config.env === 'development') {
  // eslint-disable-next-line no-console
  console.warn('[config] No .env file found — using defaults (see .env.example)');
}

module.exports = config;
