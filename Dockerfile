# Single-process Node server: physics + Colyseus + static client.
FROM node:20-slim

WORKDIR /app

# Install deps first (better layer caching). No build step, no native toolchain needed.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# App source
COPY . .

# Saved decks/boards/props live here — mount a volume at /data/assets to persist them.
ENV ASSETS_DIR=/data/assets
ENV PORT=2567
EXPOSE 2567

CMD ["node", "server.js"]
