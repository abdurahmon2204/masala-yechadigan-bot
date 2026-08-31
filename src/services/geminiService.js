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

function getModel() {
  if (model) return model;

  try {
    genAI = new GoogleGenerativeAI(config.gemini.apiKey);
    model = genAI.getGenerativeModel(
      {
        model: config.gemini.model || 'gemini-3.6-flash',
        systemInstruction: SYSTEM_PROMPT,
      },
      { apiVersion: 'v1beta' }
    );
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

function handleGeminiError(err) {
  const raw = err?.message || String(err);
  logger.error(`Gemini API error: ${raw}`);

  if (raw.includes('API key not valid') || raw.includes('API_KEY_INVALID') || raw.includes('403') || raw.includes('401')) {
    return new SolverError(
      "Gemini API kaliti noto'g'ri yoki ruxsat berilmagan. Render Environment sozlamalarini tekshiring.",
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

const GENERATION_CONFIG = {
  temperature: 0.1, // Yuqori aniqlik va kamroq keraksiz matn uchun
  topP: 0.95,
  maxOutputTokens: 3072, // Javob uzilib qolmasligi uchun kengaytirilgan limit
};

/**
 * Matnli matematik masalani yechish
 */
async function solveTextProblem(problemText) {
  if (!problemText || typeof problemText !== 'string' || !problemText.trim()) {
    throw new SolverError("Masala matni kiritilmadi.", 'EMPTY_INPUT', 400);
  }

  try {
    const gModel = getModel();
    const result = await gModel.generateContent({
      contents: [
        {
          role: 'user',
          parts: [{ text: `Ushbu matematik masalani to'liq va aniq yechib bering:\n\n${problemText.trim()}` }],
        },
      ],
      generationConfig: GENERATION_CONFIG,
    });

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
 */
async function solveImageProblem(imageBuffer, mimeType, captionText = '') {
  if (!imageBuffer || !Buffer.isBuffer(imageBuffer) || imageBuffer.length === 0) {
    throw new SolverError("Yaroqli rasm ma'lumotlari taqdim etilmadi.", 'EMPTY_IMAGE', 400);
  }

  let validMimeType = mimeType;
  if (!validMimeType || validMimeType === 'application/octet-stream') {
    validMimeType = 'image/jpeg';
  }

  const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
  if (!allowedMimeTypes.includes(validMimeType)) {
    throw new SolverError(
      `Qo'llab-quvvatlanmaydigan rasm formati: "${mimeType}". Iltimos, JPEG yoki PNG rasmini yuboring.`,
      'UNSUPPORTED_IMAGE_TYPE',
      415
    );
  }

  try {
    const gModel = getModel();

    const promptText = captionText && captionText.trim()
      ? `Rasmdagi masalani quyidagi izohga ko'ra yechib bering: "${captionText.trim()}"`
      : "Rasmdagi matematik masalani va barcha belgilarni aniq o'qib, bosqichma-bosqich yechib bering.";

    const result = await gModel.generateContent({
      contents: [
        {
          role: 'user',
          parts: [
            { text: promptText },
            {
              inlineData: {
                data: imageBuffer.toString('base64'),
                mimeType: validMimeType,
              },
            },
          ],
        },
      ],
      generationConfig: GENERATION_CONFIG,
    });

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