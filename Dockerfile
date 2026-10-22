# syntax=docker/dockerfile:1

# ─────────────────────────────────────────────────────────────────────────────
# Hamsa — single-process Next.js app with the built-in node:sqlite driver.
# Multi-stage build, non-root runtime, database on a volume at /app/data.
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
# A build-time secret is not required (the production guard skips the build
# phase), but supplying one keeps the build environment uniform.
RUN npm run build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    HAMSA_DB_PATH=/app/data/hamsa.db

RUN addgroup --system --gid 1001 hamsa \
 && adduser --system --uid 1001 --ingroup hamsa hamsa \
 && mkdir -p /app/data /app/public \
 && chown -R hamsa:hamsa /app/data

COPY --from=builder --chown=hamsa:hamsa /app/.next/standalone ./
COPY --from=builder --chown=hamsa:hamsa /app/.next/static ./.next/static
COPY --from=builder --chown=hamsa:hamsa /app/public ./public

USER hamsa
EXPOSE 3000
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=4s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server.js"]
