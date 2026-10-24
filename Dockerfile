# syntax=docker/dockerfile:1

# ─────────────────────────────────────────────────────────────────────────────
# Hamsa — Next.js standalone build + PostgreSQL + ffmpeg.
# The app process is non-root; Postgres runs as a sibling container.
# Snapshots live on a volume at /app/storage and are never public.
# ─────────────────────────────────────────────────────────────────────────────

FROM node:24-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    HAMSA_STORAGE_DIR=/app/storage

# ffmpeg is required for RTSP snapshots and MOG2 motion frames. There is no
# native Node alternative that is worth the dependency weight.
RUN apk add --no-cache ffmpeg \
 && addgroup --system --gid 1001 hamsa \
 && adduser --system --uid 1001 --ingroup hamsa hamsa \
 && mkdir -p /app/storage /app/public \
 && chown -R hamsa:hamsa /app/storage

COPY --from=builder --chown=hamsa:hamsa /app/.next/standalone ./
COPY --from=builder --chown=hamsa:hamsa /app/.next/static ./.next/static
COPY --from=builder --chown=hamsa:hamsa /app/public ./public

USER hamsa
EXPOSE 3000
VOLUME ["/app/storage"]

HEALTHCHECK --interval=30s --timeout=4s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server.js"]
