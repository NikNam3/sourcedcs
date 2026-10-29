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
# silently drops any new top-level file from the image if someone forgets
# to add it here, exactly like sourcedcs-web's Dockerfile once did
# (shipped without releases.js, crashed every container on boot).
COPY . .

ENV NODE_ENV=production
ENV PORT=4000
EXPOSE 4000

USER node

CMD ["node", "server.js"]
