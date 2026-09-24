'use strict';

/**
 * WhatsApp client lifecycle (task §11, §12): QR auth, persistent LocalAuth
 * session, reconnection with capped backoff. State machine:
 * disconnected → initializing → qr_pending → authenticating → connected
 */

const path = require('node:path');
const fs = require('node:fs');
const { execFile } = require('node:child_process');
const config = require('../config');
const logger = require('../logger');

let Client, LocalAuth; // loaded lazily so the API can boot without the dep

const state = {
  status: 'disconnected', // disconnected | initializing | qr_pending | authenticating | connected
  qr: null, // latest QR string
  qrGeneratedAt: null,
  info: null, // { phone, pushname, connectedAt }
  lastError: null,
  lastDisconnectedAt: null,
  reconnectAttempts: 0,
  client: null,
  initializing: false,
};

function ensureDeps() {
  if (Client) return;
  try {
    // eslint-disable-next-line global-require
    const wweb = require('whatsapp-web.js');
    Client = wweb.Client;
    LocalAuth = wweb.LocalAuth;
  } catch (err) {
    throw new Error('whatsapp-web.js is not installed. Run: npm install whatsapp-web.js');
  }
}

function isSessionSaved() {
  try {
    return fs.existsSync(path.join(config.whatsapp.authDir, 'session')) ||
      fs.readdirSync(config.whatsapp.authDir).some((f) => f.startsWith('session-'));
  } catch {
    return false;
  }
}

/**
 * Kill leftover headless-Chrome processes that still hold the session profile
 * lock (happens after a crash). Best-effort: uses the repo kill script on
 * Windows; silently continues on other platforms or if nothing matches.
 */
async function killZombieBrowser() {
  if (process.platform !== 'win32') return;
  const script = path.join(__dirname, '..', '..', '..', 'scripts', 'kill-wa-chrome.ps1');
  if (!fs.existsSync(script)) return;
  try {
    await new Promise((resolve) => {
      execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script],
        { timeout: 20000, windowsHide: true }, () => resolve());
    });
    await new Promise((r) => setTimeout(r, 1500)); // let locks release
  } catch {
    /* best effort */
  }
}

function createClient() {
  ensureDeps();
  return new Client({
    authStrategy: new LocalAuth({ dataPath: config.whatsapp.authDir }),
    puppeteer: {
      headless: true,
      executablePath: config.whatsapp.executablePath, // auto-detected Chrome/Edge if bundled Chromium is missing
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    },
  });
}

function attachClientHandlers(c, onSetupEnd) {
  c.on('qr', (qr) => {
    state.status = 'qr_pending';
    state.qr = qr;
    state.qrGeneratedAt = new Date().toISOString();
    logger.info('WhatsApp QR generated — waiting for scan');
  });

  c.on('authenticated', () => {
    state.status = 'authenticating';
    logger.info('WhatsApp authenticated');
  });

  c.on('auth_failure', (msg) => {
    state.status = 'disconnected';
    state.lastError = `Authentication failed: ${msg}`;
    logger.warn({ msg }, 'WhatsApp auth failure');
  });

  c.on('ready', () => {
    if (onSetupEnd) onSetupEnd();
    let phone = null;
    let pushname = null;
    try {
      const info = c.info;
      phone = info?.wid?.user ?? null;
      pushname = info?.pushname ?? null;
    } catch { /* info may not be ready */ }
    state.status = 'connected';
    state.qr = null;
    state.reconnectAttempts = 0;
    state.info = { phone, pushname, connectedAt: new Date().toISOString() };
    logger.info({ phone }, 'WhatsApp ready');
  });

  c.on('disconnected', (reason) => {
    if (onSetupEnd) onSetupEnd();
    state.status = 'disconnected';
    state.info = null;
    state.lastDisconnectedAt = new Date().toISOString();
    state.lastError = `Disconnected: ${reason}`;
    logger.warn({ reason }, 'WhatsApp disconnected');

    // Auto-reconnect with capped exponential backoff (task §33/§54: no runaway loops)
    if (state.reconnectAttempts < 5) {
      const delay = Math.min(15000 * 2 ** state.reconnectAttempts, 120000);
      state.reconnectAttempts += 1;
      logger.info({ attempt: state.reconnectAttempts, delayMs: delay }, 'Scheduling WhatsApp reconnect');
      setTimeout(() => {
        connect().catch((err) => logger.error({ err: err.message }, 'Reconnect failed'));
      }, delay);
    } else {
      state.lastError = 'Disconnected and auto-reconnect gave up after 5 attempts. Reconnect manually.';
    }
  });
}

async function connect() {
  if (state.initializing) return currentState();
  if (state.status === 'connected') return currentState();
  ensureDeps();

  fs.mkdirSync(config.whatsapp.authDir, { recursive: true });

  // Tear down any previous (possibly half-dead) client before making a new one
  if (state.client) {
    const stale = state.client;
    state.client = null;
    try { await stale.destroy(); } catch { /* already dead */ }
  }

  state.initializing = true;
  state.status = 'initializing';
  state.lastError = null;
  state.qr = null;
  state.qrGeneratedAt = null;

  const sessionTimeout = setTimeout(() => {
    if (state.status !== 'connected') {
      state.lastError = 'Session setup timed out — try again or re-scan the QR.';
      logger.warn('WhatsApp session setup timed out');
    }
  }, config.whatsapp.sessionTimeoutMs);

  const client = createClient();
  state.client = client;
  attachClientHandlers(client, () => clearTimeout(sessionTimeout));

  state.initializing = true;
  try {
    await client.initialize();
  } catch (err) {
    clearTimeout(sessionTimeout);
    state.initializing = false;
    state.client = null;
    try { await client.destroy(); } catch { /* ignore */ }

    // Classic post-crash situation: a zombie Chrome still holds the profile.
    // Kill it and retry ONCE before giving up.
    if (/browser is already running/i.test(err.message)) {
      logger.warn('Profile locked by a zombie browser — killing it and retrying once');
      await killZombieBrowser();
      try {
        const retryClient = createClient();
        state.client = retryClient;
        attachClientHandlers(retryClient, () => clearTimeout(sessionTimeout));
        await retryClient.initialize();
        state.initializing = false;
        return currentState();
      } catch (retryErr) {
        state.status = 'disconnected';
        state.lastError = retryErr.message;
        try { await retryClient.destroy(); } catch { /* ignore */ }
        state.client = null;
        throw retryErr;
      }
    }

    state.status = 'disconnected';
    state.lastError = err.message;
    throw err;
  }
  state.initializing = false;
  return currentState();
}

/**
 * Called by process-level crash guards when puppeteer/whatsapp-web.js blows up
 * mid-flight (e.g. "Execution context destroyed" during a navigation).
 * Marks the client dead without touching the possibly-broken puppeteer object.
 */
function resetAfterCrash() {
  state.client = null;
  state.initializing = false;
  if (state.status !== 'disconnected') {
    state.status = 'disconnected';
    state.info = null;
    state.qr = null;
    state.lastError = 'Internal WhatsApp client error — click Reconnect to try again.';
    logger.warn('WhatsApp client reset after internal error');
  }
}

async function disconnect({ logout = true } = {}) {
  if (state.client) {
    try {
      if (logout) await state.client.logout();
      await state.client.destroy();
    } catch (err) {
      logger.warn({ err: err.message }, 'Error during disconnect (ignored)');
    }
  }
  state.client = null;
  state.status = 'disconnected';
  state.info = null;
  state.qr = null;
  return currentState();
}

function getClient() {
  if (state.status !== 'connected' || !state.client) {
    const err = new Error('WhatsApp is not connected.');
    err.code = 'WA_NOT_CONNECTED';
    throw err;
  }
  return state.client;
}

function currentState() {
  return {
    status: state.status,
    connected: state.status === 'connected',
    phone: state.info?.phone ?? null,
    pushname: state.info?.pushname ?? null,
    connectedAt: state.info?.connectedAt ?? null,
    hasQr: Boolean(state.qr),
    qrGeneratedAt: state.qrGeneratedAt,
    sessionSaved: isSessionSaved(),
    reconnectAttempts: state.reconnectAttempts,
    lastError: state.lastError,
    lastDisconnectedAt: state.lastDisconnectedAt,
  };
}

function getQr() {
  if (!state.qr) return null;
  return { qr: state.qr, generatedAt: state.qrGeneratedAt };
}

module.exports = { connect, disconnect, resetAfterCrash, getClient, currentState, getQr };
