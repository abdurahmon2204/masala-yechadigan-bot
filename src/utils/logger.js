/**
 * src/utils/logger.js
 * ---------------------------------------------------------------------------
 * Centralized logger (winston). Logs to console always, and to files when
 * NODE_ENV=production. Using a real logger (instead of console.log) makes
 * debugging production issues far easier.
 * ---------------------------------------------------------------------------
 */

const winston = require('winston');
const config = require('../config/env');

const isProd = config.nodeEnv === 'production';

const logger = winston.createLogger({
  level: config.logLevel,
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    isProd ? winston.format.json() : winston.format.colorize({ all: true }),
    winston.format.printf(({ timestamp, level, message, stack }) => {
      return `[${timestamp}] ${level}: ${stack || message}`;
    })
  ),
  transports: [new winston.transports.Console()],
});

// In production also persist logs to disk (useful on VPS deployments;
// on ephemeral platforms like Render/Railway this is best-effort only).
if (isProd) {
  logger.add(new winston.transports.File({ filename: 'logs/error.log', level: 'error' }));
  logger.add(new winston.transports.File({ filename: 'logs/combined.log' }));
}

module.exports = logger;
