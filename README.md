# Math Solver AI — REST API + Telegram Bot

Production-ready math problem solver powered by Google Gemini. Accepts a
problem as **text** or a **photo**, and returns a clean, plain-text,
step-by-step solution (no LaTeX, no `$` symbols — just readable text).

## Features

- 🧮 Solves arithmetic, algebra, geometry, trigonometry, calculus, statistics, word problems
- 📷 Reads math directly from photos (handwritten or printed) via Gemini's vision understanding
- 📝 Strict output contract: `Problem / Concept / Step 1 / Step 2 / ... / Final Answer`, plain text only
- 🔢 Optional lightweight arithmetic cross-check (mathjs) for diagnostic logging
- 🌐 REST API (Express) usable from any client
- 🤖 Telegram bot (long polling) — text and photo support, handles Telegram's 4096-char message limit
- 🛡️ Robust error handling: invalid API key, rate limits, oversized/invalid images, empty input, malformed JSON
- 🪵 Structured logging (winston)

## Project Structure

```
math-solver-bot/
├── src/
│   ├── config/env.js              # env var loading + validation
│   ├── utils/logger.js            # winston logger
│   ├── prompts/systemPrompt.js    # the strict, non-LaTeX system prompt
│   ├── services/
│   │   ├── geminiService.js       # Gemini API calls (text + image), error mapping
│   │   └── mathService.js         # optional mathjs cross-check
│   ├── api/
│   │   ├── routes/solve.js        # POST /api/solve/text, /api/solve/image
│   │   └── middleware/
│   │       ├── upload.js          # multer (in-memory) image upload config
│   │       └── errorHandler.js    # centralized error handling
│   ├── bot/telegramBot.js         # Telegram bot (text + photo + document-image)
│   └── server.js                  # app entry point
├── .env.example
├── .gitignore
├── Dockerfile
├── package.json
└── README.md
```

## 1. Prerequisites

- Node.js >= 18
- A **Gemini API key** — free at https://aistudio.google.com/app/apikey
- (Optional, for the bot) A **Telegram Bot token** — message [@BotFather](https://t.me/BotFather) on Telegram, run `/newbot`, and copy the token it gives you.

## 2. Local Setup

```bash
# 1. Install dependencies
cd math-solver-bot
npm install

# 2. Configure environment
cp .env.example .env
# then edit .env and set GEMINI_API_KEY (and TELEGRAM_BOT_TOKEN if using the bot)

# 3. Run in development (auto-restart on changes)
npm run dev

# ...or run in production mode
npm start
```

The server starts on `http://localhost:3000` by default. If
`ENABLE_TELEGRAM_BOT=true` in `.env`, the Telegram bot starts in the same
process automatically.

## 3. REST API Usage

### Health check
```bash
curl http://localhost:3000/api/health
```

### Solve a text problem
```bash
curl -X POST http://localhost:3000/api/solve/text \
  -H "Content-Type: application/json" \
  -d '{"problem": "Solve for x: 2x + 6 = 14"}'
```

### Solve an image problem
```bash
curl -X POST http://localhost:3000/api/solve/image \
  -F "image=@/path/to/problem.jpg" \
  -F "caption=solve for x"
```

Both endpoints return:
```json
{
  "success": true,
  "data": { "solution": "Problem:\n...\n\nFinal Answer:\n..." }
}
```

On error:
```json
{ "success": false, "error": { "code": "INVALID_API_KEY", "message": "..." } }
```

## 4. Telegram Bot Usage

1. Set `TELEGRAM_BOT_TOKEN` and `ENABLE_TELEGRAM_BOT=true` in `.env`.
2. Run `npm start` (or `npm run dev`).
3. Open your bot in Telegram, send `/start`, then send a text problem or a photo.

## 5. Deployment

### Option A — Docker
```bash
docker build -t math-solver-bot .
docker run -d --env-file .env -p 3000:3000 --name math-solver-bot math-solver-bot
```

### Option B — Render / Railway / Fly.io
1. Push this repo to GitHub.
2. Create a new "Web Service" from the repo.
3. Build command: `npm install` — Start command: `npm start`.
4. Add the environment variables from `.env.example` in the platform's dashboard.
5. These platforms keep the process alive continuously, which works fine with
   the Telegram bot's long-polling mode.

### Option C — VPS with PM2
```bash
npm install -g pm2
pm2 start src/server.js --name math-solver-bot
pm2 save && pm2 startup
```

### Switching the bot to webhooks (high-traffic production)
Long polling (default here) is simplest and works well for most use cases.
For high-traffic bots, replace `polling: true` in `src/bot/telegramBot.js`
with a webhook setup (`bot.setWebHook(...)` + an Express route that calls
`bot.processUpdate(req.body)`), pointed at your public HTTPS URL.

## 6. Notes on the "hybrid execution" approach

Solving is driven primarily by carefully engineered prompting (see
`src/prompts/systemPrompt.js`), which enforces the exact step-by-step, plain
text structure requested. For pure numeric/algebraic expressions,
`src/services/mathService.js` additionally cross-checks the model's stated
final answer against an independent `mathjs` evaluation and logs a warning on
mismatch — this is a lightweight safety net, not a full symbolic solver. If
you need a stronger symbolic-math guarantee (e.g. full CAS-grade solving),
consider adding a Python microservice using **SymPy** and calling it from
`mathService.js` for expressions the LLM flags as purely symbolic.

## 7. Troubleshooting

| Symptom | Likely cause |
|---|---|
| `Missing required environment variable(s): GEMINI_API_KEY` on boot | `.env` not created or key not set |
| `401 INVALID_API_KEY` from API/bot | Gemini key is wrong, expired, or restricted |
| `429 RATE_LIMITED` | Gemini free-tier quota exceeded — wait or upgrade quota |
| `413` on image upload | Image exceeds `MAX_FILE_SIZE_MB` (default 10MB) |
| Telegram bot doesn't respond | Check `TELEGRAM_BOT_TOKEN`, `ENABLE_TELEGRAM_BOT=true`, and server logs for `polling_error` |
