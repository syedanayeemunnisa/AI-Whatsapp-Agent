'use strict';

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const config = require('./config');
const logger = require('./logger');
const db = require('./db');
const { AppError } = require('./util');
const { snapshot: healthSnapshot } = require('./services/healthService');

const app = express();

app.use(helmet());
app.use(express.json({ limit: '256kb' }));
app.use(
  cors({
    origin(origin, cb) {
      // Allow same-origin/no-origin tools (curl, Postman) and configured origins.
      if (!origin || config.corsOrigins.includes(origin)) return cb(null, true);
      return cb(new AppError(403, 'CORS_REJECTED', `Origin ${origin} is not allowed`));
    },
  })
);

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    logger.info({ method: req.method, url: req.originalUrl, status: res.statusCode, ms: Date.now() - start }, 'req');
  });
  next();
});

// Routes
app.get('/', (_req, res) => {
  res.json({ name: 'ai-whatsapp-agent backend', phase: '2', status: 'running' });
});
app.use('/api/health', require('./routes/health'));
app.use('/api/ollama', require('./routes/ollama'));
app.use('/api/auth', require('./routes/auth'));
// Sensitive routes require login (task §8)
app.use('/api/content', require('./middleware/auth').requireAuth, require('./routes/content'));
app.use('/api/whatsapp', require('./routes/whatsapp'));
app.use('/api/groups', require('./routes/groups'));
app.use('/api/schedules', require('./routes/schedules'));
app.use('/api/calendar', require('./routes/calendar'));
app.use('/api/logs', require('./routes/logs'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/system', require('./routes/system'));
// Live scheduler status for the health snapshot (was hardcoded 'not_implemented')
app.use('/api/scheduler', require('./routes/scheduler'));

// 404 for unknown API paths
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return next(new AppError(404, 'NOT_FOUND', `No route: ${req.method} ${req.path}`));
  }
  next();
});

// Central error handler — always JSON
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  const status = err instanceof AppError ? err.status : 500;
  const code = err instanceof AppError ? err.code : 'INTERNAL';
  const payload = {
    error: {
      code,
      message: err.message || 'Internal server error',
      ...(err.details ? { details: err.details } : {}),
    },
  };
  if (status >= 500) {
    logger.error({ err, url: req.originalUrl }, 'Unhandled error');
    payload.error.message =
      err instanceof AppError ? err.message : 'Internal server error';
  } else {
    logger.warn({ code, url: req.originalUrl, msg: err.message }, 'Request error');
  }
  res.status(status).json(payload);
});

/** Initialise storage, verify dependencies, then start listening. */
async function start() {
  db.initDb();

  const health = await healthSnapshot();
  logger.info('── Startup health ──');
  logger.info(`  Backend : OK (port ${config.port}, env ${config.env}${config.mockLlm ? ', MOCK LLM' : ''})`);
  logger.info(`  Database: ${health.database.ok ? 'OK' : `FAIL — ${health.database.error}`}`);
  logger.info(`  Ollama  : ${health.ollama.ok ? `OK (v${health.ollama.version})` : `NOT RUNNING — ${health.ollama.error}`}`);
  logger.info(`  Model   : ${health.model.ok ? `OK (${health.model.name})` : `UNAVAILABLE — ${health.model.hint || health.model.error || 'Ollama not reachable'}`}`);
  logger.info('  WhatsApp: (Phase 2)  Scheduler: (Phase 3)');

  return new Promise((resolve) => {
    const server = app.listen(config.port, config.host, () => {
      logger.info(`API listening on http://${config.host}:${config.port}`);
      // Phase 3: start the minute-by-minute automation scheduler with the API
      require('./scheduler').start();
      // Auto-restore the WhatsApp session if one is saved on disk, so the
      // scheduler can send after an unattended restart. With no saved session
      // this is a no-op (first run still needs a manual QR scan).
      if (require('./whatsapp/client').currentState().sessionSaved) {
        require('./whatsapp/client')
          .connect()
          .then(() => logger.info('WhatsApp session restored automatically'))
          .catch((err) => logger.warn({ err: err.message }, 'Automatic WhatsApp reconnect failed — use Connect on the WhatsApp page'));
      }
      // Phase 5: daily DB backup at 03:30 local (plus boot-time check that today's exists)
      const backupService = require('./services/backupService');
      try { backupService.runBackup(); } catch (err) { logger.warn({ err: err.message }, 'Boot backup failed'); }
      require('node-cron').schedule('30 3 * * *', () => {
        try { backupService.runBackup(); } catch (err) { logger.error({ err: err.message }, 'Daily backup failed'); }
      });
      resolve(server);
    });
  });
}

module.exports = { app, start };
