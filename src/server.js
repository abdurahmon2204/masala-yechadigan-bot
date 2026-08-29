/**
 * src/server.js
 * ---------------------------------------------------------------------------
 * Application entry point. Boots the Express REST API and, if enabled,
 * the Telegram bot (long polling) in the same process.
 * ---------------------------------------------------------------------------
 */

const express = require('express');
const config = require('./config/env');
const logger = require('./utils/logger');

const solveRoutes = require('./api/routes/solve');
const { notFoundHandler, errorHandler } = require('./api/middleware/errorHandler');

const app = express();

// --- Global middleware -----------------------------------------------------

app.use(express.json({ limit: '1mb' })); // for /api/solve/text JSON bodies
app.use(express.urlencoded({ extended: true }));

// Basic request logging
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.originalUrl}`);
  next();
});

// --- Routes ------------------------------------------------------------

app.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Math Solver API is running.',
    endpoints: {
      health: 'GET /api/health',
      solveText: 'POST /api/solve/text  { "problem": "..." }',
      solveImage: 'POST /api/solve/image  (multipart/form-data, field "image")',
    },
  });
});

app.use('/api', solveRoutes);

// 404 + centralized error handler — MUST be registered last, in this order.
app.use(notFoundHandler);
app.use(errorHandler);

// --- Start server ------------------------------------------------------

const server = app.listen(config.port, () => {
  logger.info(`🚀 Math Solver API listening on port ${config.port} (${config.nodeEnv})`);
  logger.info(`   Gemini model: ${config.gemini.model}`);
});

// --- Optionally start the Telegram bot in the same process ----------------

let bot = null;
if (config.telegram.enabled) {
  const { startTelegramBot } = require('./bot/telegramBot');
  bot = startTelegramBot();
} else {
  logger.info('ℹ️  Telegram bot disabled (ENABLE_TELEGRAM_BOT=false). Running REST API only.');
}

// --- Graceful shutdown ---------------------------------------------------

function shutdown(signal) {
  logger.info(`${signal} received. Shutting down gracefully...`);
  server.close(() => {
    logger.info('HTTP server closed.');
    if (bot) {
      bot.stopPolling().then(() => {
        logger.info('Telegram bot polling stopped.');
        process.exit(0);
      });
    } else {
      process.exit(0);
    }
  });

  // Force-exit if graceful shutdown hangs.
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Catch-all safety nets so the process doesn't die silently on bugs.
process.on('unhandledRejection', (reason) => {
  logger.error(`Unhandled promise rejection: ${reason}`);
});
process.on('uncaughtException', (err) => {
  logger.error(`Uncaught exception: ${err.stack || err.message}`);
  // Uncaught exceptions leave the process in an unknown state — exit and
  // let the process manager (pm2/Docker/systemd) restart it cleanly.
  process.exit(1);
});

module.exports = app;
