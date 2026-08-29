/**
 * src/services/geminiService.js
 * ---------------------------------------------------------------------------
 * Google Gemini API bilan muloqot qiluvchi asosiy servis.
 * - solveTextProblem(problemText)
 * - solveImageProblem(imageBuffer, mimeType, captionText)
 * ---------------------------------------------------------------------------
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const config = require('../config/env');
const logger = require('../utils/logger');
const SYSTEM_PROMPT = require('../prompts/systemPrompt');

/**
 * Xatoliklarni boshqarish uchun maxsus Error klasi
 */
class SolverError extends Error {
  constructor(message, code = 'SOLVER_ERROR', statusCode = 500) {
    super(message);
    this.name = 'SolverError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

let genAI;
let model;

/**
 * Gemini client initializer (Lazy load)
 */
function getModel() {
  if (model) return model;

  try {
    genAI = new GoogleGenerativeAI(config.gemini.apiKey);
    model = genAI.getGenerativeModel({
      model: config.gemini.model,
      systemInstruction: SYSTEM_PROMPT,
      generationConfig: {
        temperature: 0.2, // past harorat -> aniq va ishonchli matematik javoblar
        topP: 0.9,
        maxOutputTokens: 2048,
      },
    });
    return model;
  } catch (err) {
    logger.error(`Failed to initialize Gemini client: ${err.message}`);
    throw new SolverError(
      "AI modelini ishga tushirib bo'lmadi. GEMINI_API_KEY to'g'riligini tekshiring.",
      'INIT_FAILED',
      500
    );
  }
}

/**
 * Gemini SDK xatolarini ushlab, foydalanuvchiga tushunarli xabarga o'girish
 */
function handleGeminiError(err) {
  const raw = err?.message || String(err);
  logger.error(`Gemini API error: ${raw}`);

  if (raw.includes('API key not valid') || raw.includes('API_KEY_INVALID') || raw.includes('403')) {
    return new SolverError(
      "Gemini API kaliti noto'g'ri yoki ruxsat berilmagan. .env faylini tekshiring.",
      'INVALID_API_KEY',
      401
    );
  }

  if (raw.includes('429') || raw.toLowerCase().includes('quota') || raw.toLowerCase().includes('rate limit')) {
    return new SolverError(
      "AI xizmati vaqtincha band yoki limit tugadi. Birozdan so'ng qayta urinib ko'ring.",
      'RATE_LIMITED',
      429
    );
  }

  if (raw.toLowerCase().includes('safety') || raw.toLowerCase().includes('blocked')) {
    return new SolverError(
      "AI bu kontentni qayta ishlashni rad etdi. Savolni qayta shakllantiring yoki aniqroq rasm yuboring.",
      'CONTENT_BLOCKED',
      422
    );
  }

  if (raw.toLowerCase().includes('timeout') || raw.toLowerCase().includes('network') || raw.toLowerCase().includes('fetch failed')) {
    return new SolverError("AI xizmatiga ulanib bo'lmadi. Tarmoq ulanishini tekshiring.", 'NETWORK_ERROR', 503);
  }

  return new SolverError("Kutilmagan xatolik yuz berdi. Iltimos, qaytadan urinib ko'ring.", 'UNKNOWN_ERROR', 500);
}

/**
 * Matnli matematik masalani yechish
 * @param {string} problemText
 * @returns {Promise<string>} O'zbek tilidagi bosqichma-bosqich yechim
 */
async function solveTextProblem(problemText) {
  if (!problemText || typeof problemText !== 'string' || !problemText.trim()) {
    throw new SolverError("Masala matni kiritilmadi.", 'EMPTY_INPUT', 400);
  }

  try {
    const gModel = getModel();
    const result = await gModel.generateContent([
      { text: `Ushbu matematik masalani to'liq o'zbek tilida bosqichma-bosqich yechib bering:\n\n${problemText.trim()}` },
    ]);

    const response = result.response;
    const text = response.text();

    if (!text || !text.trim()) {
      throw new SolverError("AI bo'sh javob qaytardi. Masalani boshqacharoq yuborib ko'ring.", 'EMPTY_RESPONSE', 502);
    }

    return text.trim();
  } catch (err) {
    if (err instanceof SolverError) throw err;
    throw handleGeminiError(err);
  }
}

/**
 * Rasmli matematik masalani yechish
 * @param {Buffer} imageBuffer 
 * @param {string} mimeType 
 * @param {string} [captionText] 
 * @returns {Promise<string>} O'zbek tilidagi bosqichma-bosqich yechim
 */
async function solveImageProblem(imageBuffer, mimeType, captionText = '') {
  if (!imageBuffer || !Buffer.isBuffer(imageBuffer) || imageBuffer.length === 0) {
    throw new SolverError("Yaroqli rasm ma'lumotlari taqdim etilmadi.", 'EMPTY_IMAGE', 400);
  }

  // Telegram Hujjat (Document) rejimida yuborilgan rasmlarni qo'llab-quvvatlash
  let validMimeType = mimeType;
  if (!validMimeType || validMimeType === 'application/octet-stream') {
    validMimeType = 'image/jpeg';
  }

  const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
  if (!allowedMimeTypes.includes(validMimeType)) {
    throw new SolverError(
      `Qo'llab-quvvatlanmaydigan rasm formati: "${mimeType}". Iltimos, JPEG, PNG yoki WEBP rasmini yuboring.`,
      'UNSUPPORTED_IMAGE_TYPE',
      415
    );
  }

  try {
    const gModel = getModel();

    const promptText = captionText && captionText.trim()
      ? `Rasmdagi matematik masalani foydalanuvchining ushbu izohini inobatga olgan holda o'zbek tilida yechib bering: "${captionText.trim()}"`
      : "Rasmdagi matematik masalani diqqat bilan o'qib, uni o'zbek tilida bosqichma-bosqich yechib bering.";

    const result = await gModel.generateContent([
      { text: promptText },
      {
        inlineData: {
          data: imageBuffer.toString('base64'),
          mimeType: validMimeType,
        },
      },
    ]);

    const response = result.response;
    const text = response.text();

    if (!text || !text.trim()) {
      throw new SolverError(
        "AI ushbu rasmdan yechim chiqara olmadi. Aniqroq va yoritilgan rasm yuboring.",
        'EMPTY_RESPONSE',
        502
      );
    }

    return text.trim();
  } catch (err) {
    if (err instanceof SolverError) throw err;
    throw handleGeminiError(err);
  }
}

module.exports = {
  solveTextProblem,
  solveImageProblem,
  SolverError,
};