'use strict';

// Thin entry point — the app lives in src/app.js
const { start } = require('./src/app');

// Crash guards: a puppeteer/whatsapp-web.js error must never take the whole
// API down (unhandled rejections crash Node 15+ by default — we log instead).
process.on('unhandledRejection', (reason) => {
  require('./src/logger').error(
    { err: (reason && reason.stack) || String(reason) },
    'Unhandled promise rejection — server kept alive'
  );
  resetWhatsAppAfterCrash();
});
process.on('uncaughtException', (err) => {
  require('./src/logger').error(
    { err: (err && err.stack) || String(err) },
    'Uncaught exception — server kept alive'
  );
  resetWhatsAppAfterCrash();
});

function resetWhatsAppAfterCrash() {
  try {
    require('./src/whatsapp/client').resetAfterCrash();
  } catch {
    /* whatsapp module optional — ignore */
  }
}

start()
  .then((server) => {
    const shutdown = (signal) => {
      require('./src/logger').info({ signal }, 'Shutting down…');
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 2000).unref();
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  })
  .catch((err) => {
    console.error('Fatal startup error:', err);
    process.exit(1);
  });
