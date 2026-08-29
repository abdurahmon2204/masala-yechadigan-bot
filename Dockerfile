# --- Build/runtime image -------------------------------------------------
FROM node:18-alpine

WORKDIR /app

# Install dependencies first (better layer caching)
COPY package*.json ./
RUN npm install --omit=dev

# Copy the rest of the source
COPY . .

# Cloud platforms (Render/Railway/Fly.io) inject PORT; default kept for local runs
ENV PORT=3000
EXPOSE 3000

CMD ["node", "src/server.js"]
