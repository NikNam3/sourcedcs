# ─── Build stage ──────────────────────────────────────────
FROM node:22-alpine AS deps

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ─── Runtime stage ────────────────────────────────────────
FROM node:22-alpine

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules

# Whole (filtered) context rather than a per-file list -- an explicit list
# silently drops any new top-level module from the image if someone forgets
# to add it here (releases.js did exactly this once). .dockerignore is the
# actual exclusion list; keep it in sync when adding new top-level
# directories that shouldn't ship (most importantly: never remove `data`
# from it -- see its own comment there).
COPY . .

RUN mkdir -p /app/data && chown -R node:node /app/data

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

USER node

CMD ["node", "server.js"]