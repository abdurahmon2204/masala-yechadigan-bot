/**
 * src/bot/telegramBot.js
 * ---------------------------------------------------------------------------
 * Telegram Bot interface. Uses long polling (simplest, no public HTTPS URL
 * required — good for local dev and small-to-medium deployments). Swap to
 * webhooks for high-traffic production use (see README "Deployment" notes).
 *
 * Supported interactions:
 *   /start, /help  -> usage instructions
 *   plain text     -> treated as a math problem to solve
 *   photo          -> downloaded and solved via Gemini image understanding
 *                      (photo caption, if any, is passed along as context)
 *   documents that are images -> also supported (Telegram sends some images
 *      as "document" when sent uncompressed)
 * ---------------------------------------------------------------------------
 */

const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

const config = require('../config/env');
const logger = require('../utils/logger');
const geminiService = require('../services/geminiService');
const mathService = require('../services/mathService');

const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;

/**
 * Split a long solution into Telegram-safe chunks (<=4096 chars), breaking
 * on line boundaries where possible so steps aren't cut mid-sentence.
 */
function splitMessage(text, maxLen = TELEGRAM_MAX_MESSAGE_LENGTH) {
  if (text.length <= maxLen) return [text];

  const chunks = [];
  let remaining = text;

  while (remaining.length > maxLen) {
    let splitIndex = remaining.lastIndexOf('\n', maxLen);
    if (splitIndex <= 0) splitIndex = maxLen; // no newline found, hard-split
    chunks.push(remaining.slice(0, splitIndex));
    remaining = remaining.slice(splitIndex).trimStart();
  }
  if (remaining) chunks.push(remaining);

  return chunks;
}

/**
 * Download a Telegram file (by file_id) into an in-memory Buffer.
 */
async function downloadTelegramFile(bot, fileId) {
  const fileLink = await bot.getFileLink(fileId); // full downloadable URL
  const response = await axios.get(fileLink, { responseType: 'arraybuffer', timeout: 20000 });
  return {
    buffer: Buffer.from(response.data),
    mimeType: response.headers['content-type'] || 'image/jpeg',
  };
}

/**
 * Send a solution to a chat, splitting into multiple messages if needed and
 * showing a "typing..." indicator while the AI is working.
 */
async function sendSolution(bot, chatId, solutionText) {
  const chunks = splitMessage(solutionText);
  for (const chunk of chunks) {
    // eslint-disable-next-line no-await-in-loop
    await bot.sendMessage(chatId, chunk);
  }
}

/**
 * Translate a caught error into a short, user-friendly Telegram message.
 */
function friendlyErrorMessage(err) {
  if (err?.code === 'INVALID_API_KEY') {
    return '⚠️ The bot is misconfigured (invalid AI API key). Please contact the administrator.';
  }
  if (err?.code === 'RATE_LIMITED') {
    return '⏳ The AI service is busy right now. Please try again in a moment.';
  }
  if (err?.code === 'CONTENT_BLOCKED') {
    return '🚫 The AI could not process that content. Try a clearer photo or rephrase your problem.';
  }
  if (err?.code === 'UNSUPPORTED_IMAGE_TYPE') {
    return '🖼️ Unsupported image format. Please send a JPEG, PNG, or WEBP photo.';
  }
  if (err?.code === 'EMPTY_INPUT' || err?.code === 'EMPTY_IMAGE') {
    return '❓ I didn\'t receive any problem to solve. Please send text or a photo of a math problem.';
  }
  return '❌ Something went wrong while solving that problem. Please try again.';
}

/**
 * Initialize and start the Telegram bot (long polling).
 * @returns {TelegramBot} the running bot instance
 */
function startTelegramBot() {
  const bot = new TelegramBot(config.telegram.token, { polling: true });

  logger.info('🤖 Telegram bot started (long polling mode).');

  // --- Commands ---------------------------------------------------------

  bot.onText(/^\/start$/, (msg) => {
    bot.sendMessage(
      msg.chat.id,
      "👋 Hi! I'm MathSolver AI.\n\n" +
        'Send me a math problem as TEXT, or send a PHOTO of a math problem ' +
        '(handwritten or printed), and I will solve it step by step.\n\n' +
        'Type /help for more info.'
    );
  });

  bot.onText(/^\/help$/, (msg) => {
    bot.sendMessage(
      msg.chat.id,
      'How to use MathSolver AI:\n\n' +
        '• Type any math problem as a message, e.g.:\n' +
        '  "Solve for x: 3x - 7 = 11"\n\n' +
        '• Or send a PHOTO of a problem (worksheet, textbook, whiteboard). ' +
        'You can add a caption for extra context, e.g. "solve for y".\n\n' +
        'I support arithmetic, algebra, geometry, trigonometry, calculus, ' +
        'statistics, and word problems. Answers are step-by-step in plain text.'
    );
  });

  // --- Text messages (treated as math problems) --------------------------

  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;

    // Skip commands (handled above) and non-text/non-photo messages here.
    if (!msg.text || msg.text.startsWith('/')) return;

    try {
      await bot.sendChatAction(chatId, 'typing');
      logger.info(`[Telegram] Text problem from chat ${chatId}: "${msg.text.slice(0, 80)}"`);

      const solution = await geminiService.solveTextProblem(msg.text);
      mathService.crossCheckIfPossible(msg.text, solution);

      await sendSolution(bot, chatId, solution);
    } catch (err) {
      logger.error(`[Telegram] Error solving text problem: ${err.message}`);
      await bot.sendMessage(chatId, friendlyErrorMessage(err));
    }
  });

  // --- Photo messages ------------------------------------------------------

  bot.on('photo', async (msg) => {
    const chatId = msg.chat.id;

    try {
      await bot.sendChatAction(chatId, 'typing');

      // Telegram sends multiple resolutions; take the highest-quality one.
      const bestPhoto = msg.photo[msg.photo.length - 1];
      const caption = msg.caption || '';

      logger.info(`[Telegram] Photo problem from chat ${chatId} (file_id=${bestPhoto.file_id})`);

      const { buffer, mimeType } = await downloadTelegramFile(bot, bestPhoto.file_id);
      const solution = await geminiService.solveImageProblem(buffer, mimeType, caption);

      await sendSolution(bot, chatId, solution);
    } catch (err) {
      logger.error(`[Telegram] Error solving image problem: ${err.message}`);
      await bot.sendMessage(chatId, friendlyErrorMessage(err));
    }
  });

  // --- Images sent as uncompressed "documents" ------------------------------

  bot.on('document', async (msg) => {
    const chatId = msg.chat.id;
    const doc = msg.document;

    if (!doc.mime_type || !doc.mime_type.startsWith('image/')) {
      return; // not an image document — ignore silently
    }

    try {
      await bot.sendChatAction(chatId, 'typing');
      logger.info(`[Telegram] Document-image problem from chat ${chatId} (${doc.mime_type})`);

      const { buffer, mimeType } = await downloadTelegramFile(bot, doc.file_id);
      const solution = await geminiService.solveImageProblem(buffer, mimeType, msg.caption || '');

      await sendSolution(bot, chatId, solution);
    } catch (err) {
      logger.error(`[Telegram] Error solving document-image problem: ${err.message}`);
      await bot.sendMessage(chatId, friendlyErrorMessage(err));
    }
  });

  // --- Bot-level error handling (polling errors, network hiccups, etc.) ----

  bot.on('polling_error', (err) => {
    logger.error(`[Telegram] Polling error: ${err.message}`);
  });

  bot.on('webhook_error', (err) => {
    logger.error(`[Telegram] Webhook error: ${err.message}`);
  });

  return bot;
}

module.exports = { startTelegramBot };
