# ============================================================================
# managemyteam.io — web app Dockerfile (Railway-native build).
#
# Multi-stage:
#   deps    — install production deps from web/package-lock.json (node:20-slim)
#   builder — copy sources, run `next build` with dummy build-time envs
#   runner  — slim runtime; starts Next with `next start`, respecting $PORT
#
# Why multi-stage: the builder stage contains the full toolchain + dev deps
# and ~2 GB of build artifacts; the runner keeps only node_modules and the
# built output, so the pushed image stays small and Railway restarts are fast.
#
# Why default output (not output:'standalone'): web/next.config.mjs sets no
# standalone output, so the runtime simply runs `next start` against the
# .next build output. next.config.mjs was left alone deliberately.
#
# Build-time envs: `next build` statically renders pages and initializes
# modules at import time. Real DATABASE_URL / AUTH_SECRET are not available
# (and must not be baked into the image), so the build stage passes dummies.
# Nothing at build time connects to Postgres (pools are lazy) and Auth.js
# accepts a dummy secret during prerendering; real values come from the
# Railway service env at runtime.
#
# Runtime: Railway injects PORT for the web service. The CMD uses the shell
# form so `next start -p ${PORT:-3000}` honors it, falling back to 3000 for
# local `docker run` without -e PORT.
#
# Build context is the repo ROOT (railway.json points here), so all COPY
# paths below are relative to the repo root.
# ============================================================================

# ---------------------------------------------------------------------------
# Stage 1: deps — install exactly what's locked in web/package-lock.json
# ---------------------------------------------------------------------------
FROM node:20-slim AS deps
WORKDIR /app/web
# Copy only manifests first so Docker layer-caches node_modules across rebuilds.
COPY web/package.json web/package-lock.json ./
RUN npm ci

# ---------------------------------------------------------------------------
# Stage 2: builder — compile the Next.js app
# ---------------------------------------------------------------------------
FROM node:20-slim AS builder
WORKDIR /app/web
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/web/node_modules ./node_modules
COPY web ./
# Dummy build-time values. Real secrets come from the Railway service env at
# runtime; these exist only so `next build` can prerender without crashing.
ENV DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres \
    DATABASE_OWNER_URL=postgres://postgres:postgres@localhost:5432/postgres \
    AUTH_SECRET=build-time-dummy-secret-00000000000000000000000000000000 \
    AUTH_URL=http://localhost:3000 \
    PHOTOS_DIR=/data/photos \
    NEXT_PUBLIC_APP_NAME=managemyteam
RUN npm run build

# ---------------------------------------------------------------------------
# Stage 3: runner — small production runtime
# ---------------------------------------------------------------------------
FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1
# Copy runtime artifacts only: no source tree, no dev deps.
COPY web/package.json web/package-lock.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/web/.next ./.next
COPY --from=builder /app/web/public ./public
EXPOSE 3000
# Shell form so Railway's PORT is honored ($PORT:-3000 => 3000 locally).
CMD ["sh", "-c", "node_modules/.bin/next start -p ${PORT:-3000}"]
