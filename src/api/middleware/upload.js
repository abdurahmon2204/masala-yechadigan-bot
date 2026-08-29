/**
 * src/api/middleware/upload.js
 * ---------------------------------------------------------------------------
 * Multer configuration for handling image uploads on the REST API.
 * Uses in-memory storage (no disk writes) since images are forwarded
 * straight to the Gemini API as a base64 buffer.
 * ---------------------------------------------------------------------------
 */

const multer = require('multer');
const config = require('../../config/env');

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', `Unsupported file type: ${file.mimetype}`));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: config.upload.maxFileSizeMb * 1024 * 1024,
  },
});

module.exports = upload;
