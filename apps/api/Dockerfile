# syntax=docker/dockerfile:1
#
# Multi-stage build for @x/api. Workspace packages (packages/db, utils,
# contracts) export raw TypeScript ("./src/index.ts" — see CODESTYLE.md §4
# on why: dev/test tooling transpiles on the fly, no dist-staleness to
# manage). The runtime stage therefore loads the compiled app through tsx's
# Node loader hook instead of a bare `node`, so it can still resolve those
# sibling ".ts" imports — everything else about the image (non-root user,
# no shell in principle, prod-only deps) stays as locked down as a
# node:slim base allows.

FROM node:22-slim AS base
RUN corepack enable

# ── Prune the workspace down to what @x/api actually needs ────────────────
FROM base AS pruner
WORKDIR /app
RUN npm install -g turbo@^2.3.3
COPY . .
RUN turbo prune @x/api --docker

# ── Install dependencies (cached separately from source changes) ──────────
FROM base AS installer
WORKDIR /app
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile

# ── Build ───────────────────────────────────────────────────────────────
FROM installer AS builder
WORKDIR /app
COPY --from=pruner /app/out/full/ .
RUN pnpm exec turbo run build --filter=@x/api
# Not pruning devDependencies here: `pnpm prune --prod` against this
# turbo-pruned workspace wipes every per-package node_modules symlink
# outright (verified — a pnpm/turborepo interaction quirk, not a real
# reason to keep them), which breaks module resolution entirely. Trades a
# larger image for one that actually boots; revisit if image size becomes
# a real constraint.

# ── Runtime ─────────────────────────────────────────────────────────────
FROM base AS runner
WORKDIR /app
# ffprobe (ROADMAP.md 2.7) — finalize's own synchronous video-duration check
# (media.service.ts's finalizeVideo) reads container metadata only, never
# decodes a frame, so it's cheap enough to run inline in a request handler;
# apps/workers' Dockerfile installs the same package for the actual
# transcode, which does need to isolate/limit it (ffmpeg-runner.ts).
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*
RUN groupadd --system --gid 1001 nodeapp \
  && useradd --system --uid 1001 --gid nodeapp apiuser
COPY --from=builder --chown=apiuser:nodeapp /app .
USER apiuser
ENV NODE_ENV=production
EXPOSE 3001
# WORKDIR (not just the entry path) must be apps/api: "tsx/esm" is a
# dependency declared in apps/api/package.json, and pnpm's isolated
# node_modules only makes it resolvable from within that package's own
# directory, not from the pruned workspace root.
WORKDIR /app/apps/api
CMD ["node", "--import", "tsx/esm", "dist/server.js"]
