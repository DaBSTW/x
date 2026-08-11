# syntax=docker/dockerfile:1
#
# Multi-stage build for @x/web. Next.js's standalone output (next.config.ts)
# does the hard part: webpack already resolves and transpiles the workspace
# packages (@x/sdk, @x/contracts) at build time, so the runtime image is a
# plain `node server.js` — no tsx/ts-node loader needed, unlike apps/api
# (see apps/api/Dockerfile for why that one does).

FROM node:22-slim AS base
RUN corepack enable

# ── Prune the workspace down to what @x/web actually needs ────────────────
FROM base AS pruner
WORKDIR /app
RUN npm install -g turbo@^2.3.3
COPY . .
RUN turbo prune @x/web --docker

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
RUN pnpm exec turbo run build --filter=@x/web

# ── Runtime ─────────────────────────────────────────────────────────────
FROM base AS runner
WORKDIR /app
RUN groupadd --system --gid 1001 nodeapp \
  && useradd --system --uid 1001 --gid nodeapp webuser
COPY --from=builder --chown=webuser:nodeapp /app/apps/web/.next/standalone ./
COPY --from=builder --chown=webuser:nodeapp /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=webuser:nodeapp /app/apps/web/public ./apps/web/public
USER webuser
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
