# ---- Open Tabletop server ----------------------------------------------------
# Plain ESM app, no build step. Client libs (Three, Colyseus) are vendored under
# public/vendor/ and shipped in the image. Uploaded assets live in ASSETS_DIR,
# which should be a mounted volume so they survive container restarts.
FROM node:22-alpine

WORKDIR /app

# Deps first so this layer caches unless package.json / lockfile change.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# App source: server.js, db.js, auth.js, shared/, public/ (incl. vendor/), postgres/.
COPY . .

ENV NODE_ENV=production
ENV ASSETS_DIR=/data/assets
EXPOSE 2567

CMD ["npm", "start"]
