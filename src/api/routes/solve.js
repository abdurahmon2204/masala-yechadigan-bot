/**
 * src/api/routes/solve.js
 * ---------------------------------------------------------------------------
 * REST API endpoints:
 *
 *   GET  /api/health              -> liveness check
 *   POST /api/solve/text          -> body: { "problem": "2x + 6 = 14" }
 *   POST /api/solve/image         -> multipart/form-data, field name "image"
 *                                     (optional field "caption" for extra context)
 * ---------------------------------------------------------------------------
 */

const express = require('express');
const router = express.Router();

const upload = require('../middleware/upload');
const { asyncHandler } = require('../middleware/errorHandler');
const geminiService = require('../../services/geminiService');
const mathService = require('../../services/mathService');
const logger = require('../../utils/logger');

/**
 * GET /api/health
 * Simple liveness/readiness probe for load balancers / uptime monitors.
 */
router.get('/health', (req, res) => {
  res.status(200).json({ success: true, status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * POST /api/solve/text
 * Body (application/json): { "problem": "<math problem text>" }
 */
router.post(
  '/solve/text',
  asyncHandler(async (req, res) => {
    const { problem } = req.body || {};

    if (!problem || typeof problem !== 'string' || !problem.trim()) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_FIELD', message: 'Request body must include a non-empty "problem" string.' },
      });
    }

    logger.info(`[API] Solving text problem: "${problem.slice(0, 80)}${problem.length > 80 ? '...' : ''}"`);

    const solution = await geminiService.solveTextProblem(problem);

    // Best-effort diagnostic cross-check (never blocks the response)
    mathService.crossCheckIfPossible(problem, solution);

    return res.status(200).json({
      success: true,
      data: { problem, solution },
    });
  })
);

/**
 * POST /api/solve/image
 * multipart/form-data:
 *   - "image"   (required) the image file
 *   - "caption" (optional) extra text context, e.g. "solve for x only"
 */
router.post(
  '/solve/image',
  upload.single('image'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_FILE', message: 'Request must include an "image" file field.' },
      });
    }

    const caption = req.body?.caption || '';

    logger.info(`[API] Solving image problem (${req.file.mimetype}, ${(req.file.size / 1024).toFixed(1)} KB)`);

    const solution = await geminiService.solveImageProblem(req.file.buffer, req.file.mimetype, caption);

    return res.status(200).json({
      success: true,
      data: { caption: caption || null, solution },
    });
  })
);

module.exports = router;
