# syntax=docker/dockerfile:1
# Build from the repo root: the lockfile lives there (npm workspaces).
# Debian-based image on purpose: the lockfile pins the glibc SWC binary (@next/swc-linux-x64-gnu); Alpine/musl would need a different one.

FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY frontend/package.json frontend/
COPY ayze_src/package.json ayze_src/
RUN npm ci --workspace frontend --include-workspace-root=false

FROM node:22-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# The workspace lockfile hoists some packages to the root and nests others (next among them) under frontend/.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/frontend/node_modules ./frontend/node_modules
COPY package.json ./
COPY frontend/ frontend/
RUN npm run build -w frontend

FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
# Registry (custodial seeds, escrow fulfillments) and the platform wallet live here: mount it.
ENV AYZE_DATA_DIR=/data
COPY --chown=node:node --from=builder /app/frontend/.next/standalone ./
COPY --chown=node:node --from=builder /app/frontend/.next/static ./frontend/.next/static
COPY --chown=node:node --from=builder /app/frontend/public ./frontend/public
RUN mkdir -p /data && chown node:node /data
# No VOLUME instruction: Railway rejects it. Mount persistent storage at /data
# (docker: -v ayze-data:/data; Railway: attach a Volume with mount path /data).
USER node
EXPOSE 3000
CMD ["node", "frontend/server.js"]
