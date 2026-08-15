# syntax=docker/dockerfile:1
#
# Multi-stage build for @x/admin — same shape as apps/web/Dockerfile (see
# that file's own comment for why this is a plain `node server.js` at
# runtime, unlike apps/api).

FROM node:22-slim AS base
RUN corepack enable

# ── Prune the workspace down to what @x/admin actually needs ──────────────
FROM base AS pruner
WORKDIR /app
RUN npm install -g turbo@^2.3.3
COPY . .
RUN turbo prune @x/admin --docker

# ── Install dependencies (cached separately from source changes) ──────────
FROM base AS installer
WORKDIR /app
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile

# ── Build ───────────────────────────────────────────────────────────────
FROM installer AS builder
WORKDIR /app
COPY --from=pruner /app/out/full/ .
ARG NEXT_PUBLIC_API_URL=https://api.example.com/v1
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
RUN pnpm exec turbo run build --filter=@x/admin

# ── Runtime ─────────────────────────────────────────────────────────────
FROM base AS runner
WORKDIR /app
RUN groupadd --system --gid 1001 nodeapp \
  && useradd --system --uid 1001 --gid nodeapp adminuser
COPY --from=builder --chown=adminuser:nodeapp /app/apps/admin/.next/standalone ./
COPY --from=builder --chown=adminuser:nodeapp /app/apps/admin/.next/static ./apps/admin/.next/static
USER adminuser
ENV NODE_ENV=production
EXPOSE 3003
ENV PORT=3003
CMD ["node", "apps/admin/server.js"]
