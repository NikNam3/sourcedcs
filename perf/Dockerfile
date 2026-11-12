# perf: a static app (docs/wip/TOLD.md, "Deployment and operations"). Two stages: Node compiles src/ to web/js/,
# nginx serves web/ and data/ under /f16/. The image holds no Node, no source and no package.
# ─── Build stage ──────────────────────────────────────────
FROM node:22-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# Whole (filtered) context, as in the other images: a per-file list silently drops a new file.
COPY . .
RUN npm run build

# ─── Runtime stage ────────────────────────────────────────
FROM nginx:alpine

COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/web /usr/share/perf/f16
COPY --from=build /app/data /usr/share/perf/f16/data

EXPOSE 80
