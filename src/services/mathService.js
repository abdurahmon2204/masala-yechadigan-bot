/**
 * src/services/mathService.js
 * ---------------------------------------------------------------------------
 * OPTIONAL "hybrid execution" helper.
 *
 * The core solving is done by the LLM (prompt engineering with a strict
 * output structure, see prompts/systemPrompt.js). For PURE numeric/algebraic
 * expressions, we additionally cross-check the model's arithmetic using
 * mathjs, and log a warning if the LLM's final numeric answer disagrees with
 * an independent symbolic/numeric evaluation. This catches the most common
 * LLM failure mode (arithmetic slips) without changing the response format.
 *
 * This is intentionally lightweight — it does NOT attempt to parse or solve
 * full word problems or multi-step algebra; that remains the LLM's job.
 * ---------------------------------------------------------------------------
 */

const math = require('mathjs');
const logger = require('../utils/logger');

/**
 * Try to evaluate a raw arithmetic/algebraic expression with mathjs.
 * Returns null if the expression can't be parsed/evaluated (e.g. it's a
 * word problem or contains an unbound variable) — that's expected and fine.
 *
 * @param {string} expression e.g. "12 * (3 + 4) / 2"
 * @returns {number|string|null}
 */
function tryEvaluateExpression(expression) {
  try {
    const result = math.evaluate(expression);
    return typeof result === 'object' ? result.toString() : result;
  } catch (err) {
    // Not a directly-evaluable expression (word problem, has variables, etc.)
    // This is a normal, expected outcome — not an error worth surfacing.
    return null;
  }
}

/**
 * Extract the numeric value following "Final Answer:" in the model's output,
 * if present, for lightweight sanity logging.
 *
 * @param {string} solutionText
 * @returns {string|null}
 */
function extractFinalAnswer(solutionText) {
  const match = solutionText.match(/Final Answer:\s*(.+)/i);
  return match ? match[1].trim().split('\n')[0] : null;
}

/**
 * Best-effort cross-check: if the ORIGINAL problem is a plain arithmetic
 * expression (no words, just numbers/operators), independently evaluate it
 * and log a warning if it disagrees with the model's stated final answer.
 * This never throws and never blocks the response — it's purely a
 * diagnostic aid for logs/monitoring.
 *
 * @param {string} originalProblem
 * @param {string} solutionText
 */
function crossCheckIfPossible(originalProblem, solutionText) {
  const looksLikePureExpression = /^[\d\s+\-*/^().]+$/.test(originalProblem.trim());
  if (!looksLikePureExpression) return;

  const expected = tryEvaluateExpression(originalProblem);
  const stated = extractFinalAnswer(solutionText);

  if (expected !== null && stated !== null) {
    const expectedNum = parseFloat(expected);
    const statedNum = parseFloat(stated);
    if (!Number.isNaN(expectedNum) && !Number.isNaN(statedNum) && Math.abs(expectedNum - statedNum) > 1e-6) {
      logger.warn(
        `Arithmetic cross-check mismatch. Expression: "${originalProblem}" | mathjs=${expected} | LLM stated="${stated}"`
      );
    }
  }
}

module.exports = {
  tryEvaluateExpression,
  extractFinalAnswer,
  crossCheckIfPossible,
};
