FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
# Runtime state lives here, not in config/ (see src/state-paths.js). Created
# and chowned BEFORE dropping to `node`: COPY runs as root, so /app is
# root-owned, and the service could not otherwise write its own Board
# snapshot, audit log or DEM cache. In the compose stack this path is a volume;
# without one it is simply a directory inside the container, which is the
# pre-existing behaviour and is what makes a plain `docker run` still work.
RUN mkdir -p /app/data && chown -R node:node /app/data
EXPOSE 3000
USER node
CMD ["node", "server.js"]
