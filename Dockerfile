# ---- Open Tabletop server ----------------------------------------------------
# Plain ESM app, no build step. Client libs (Three, Colyseus) are vendored under
# public/vendor/ and shipped in the image. Uploaded assets live in ASSETS_DIR,
# which should be a mounted volume so they survive container restarts.
FROM node:24-alpine

WORKDIR /app

# Deps first so this layer caches unless package.json / lockfile change.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# App source: server.js, db.js, auth.js, shared/, public/ (incl. vendor/), postgres/.
COPY . .

ENV NODE_ENV=production
ENV ASSETS_DIR=/data/assets

# Keep the numeric identity stable for NFS/bind-mounted asset storage. These defaults
# match the user/group assigned by the published 0.18.0 image.
ARG APP_UID=100
ARG APP_GID=101

# Create the non-root user and give it ownership of the assets directory.
# The app writes to ASSETS_DIR (e.g. for uploaded images, boards, props).
# In Docker deployments this is typically a mounted volume, so the chown
# on the pre-created empty dir is a no-op, but it ensures the path exists
# if someone runs without a volume mount.
RUN addgroup -S -g "$APP_GID" appgroup \
    && adduser -S -D -H -u "$APP_UID" -G appgroup appuser \
    && mkdir -p /data/assets \
    && chown -R appuser:appgroup /data/assets /app

EXPOSE 2567

USER appuser

CMD ["npm", "start"]
