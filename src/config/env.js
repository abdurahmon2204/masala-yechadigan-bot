/**
 * src/config/env.js
 * ---------------------------------------------------------------------------
 * Loads and validates all environment variables in ONE place.
 * If a required variable is missing, the app fails fast at boot time with a
 * clear error message instead of crashing later mid-request.
 * ---------------------------------------------------------------------------
 */

require('dotenv').config();

/**
 * Required variables — the app cannot function without these.
 */
const REQUIRED_VARS = ['GEMINI_API_KEY'];

/**
 * Validate presence of required env vars. Throws on startup if missing.
 */
function validateEnv() {
  const missing = REQUIRED_VARS.filter((key) => !process.env[key] || process.env[key].trim() === '');

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(', ')}. ` +
        `Copy .env.example to .env and fill in the values.`
    );
  }
}

validateEnv();

const config = {
  port: parseInt(process.env.PORT, 10) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',

  gemini: {
    apiKey: process.env.GEMINI_API_KEY,
    model: process.env.GEMINI_MODEL || 'gemini-1.5-pro',
  },

  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN || null,
    enabled: (process.env.ENABLE_TELEGRAM_BOT || 'false').toLowerCase() === 'true',
  },

  upload: {
    maxFileSizeMb: parseInt(process.env.MAX_FILE_SIZE_MB, 10) || 10,
  },

  logLevel: process.env.LOG_LEVEL || 'info',
};

// Extra sanity check: Telegram bot enabled but no token provided.
if (config.telegram.enabled && !config.telegram.token) {
  throw new Error(
    'ENABLE_TELEGRAM_BOT is true but TELEGRAM_BOT_TOKEN is missing. ' +
      'Set the token or set ENABLE_TELEGRAM_BOT=false.'
  );
}

module.exports = config;
