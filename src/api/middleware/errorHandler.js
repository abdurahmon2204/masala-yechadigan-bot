/**
 * src/api/middleware/errorHandler.js
 * ---------------------------------------------------------------------------
 * Centralized Express error-handling middleware. Every route in this app
 * forwards errors here via next(err) (or by throwing inside an async
 * wrapper — see asyncHandler below). This guarantees a single, consistent
 * JSON error shape for API consumers and prevents stack traces from leaking
 * to clients in production.
 * ---------------------------------------------------------------------------
 */

const multer = require('multer');
const logger = require('../../utils/logger');
const { SolverError } = require('../../services/geminiService');
const config = require('../../config/env');

/**
 * Wrap async route handlers so thrown errors / rejected promises are
 * automatically forwarded to the error-handling middleware, instead of
 * crashing the process or hanging the request.
 */
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

/**
 * 404 handler — must be mounted AFTER all valid routes.
 */
function notFoundHandler(req, res) {
  res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.originalUrl} not found.` },
  });
}

/**
 * Final error handler — must be mounted LAST, after all routes and
 * notFoundHandler, with the (err, req, res, next) signature Express requires.
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // 1. Known, expected "solver" errors (bad key, empty input, blocked, etc.)
  if (err instanceof SolverError) {
    return res.status(err.statusCode).json({
      success: false,
      error: { code: err.code, message: err.message },
    });
  }

  // 2. Multer upload errors (file too large, wrong type, etc.)
  if (err instanceof multer.MulterError) {
    const isTooLarge = err.code === 'LIMIT_FILE_SIZE';
    return res.status(isTooLarge ? 413 : 400).json({
      success: false,
      error: {
        code: err.code,
        message: isTooLarge
          ? `Image too large. Max size is ${config.upload.maxFileSizeMb}MB.`
          : err.message,
      },
    });
  }

  // 3. Malformed JSON body
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_JSON', message: 'Request body contains invalid JSON.' },
    });
  }

  // 4. Anything else — log full detail server-side, return a safe generic message.
  logger.error(`Unhandled error: ${err.stack || err.message}`);
  return res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: config.nodeEnv === 'production' ? 'An unexpected error occurred.' : err.message,
    },
  });
}

module.exports = { asyncHandler, notFoundHandler, errorHandler };
