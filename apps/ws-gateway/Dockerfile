# syntax=docker/dockerfile:1
#
# Multi-stage build for @x/ws-gateway — same shape and tradeoffs as
# apps/api/Dockerfile (see that file's header comment): workspace packages
# export raw TypeScript, so the runtime stage loads the compiled entrypoint
# through tsx's Node loader hook, and devDependencies are left unpruned for
# the same pnpm/turborepo symlink-wiping reason documented in ADR 0003.

FROM node:22-slim AS base
RUN corepack enable

FROM base AS pruner
WORKDIR /app
RUN npm install -g turbo@^2.3.3
COPY . .
RUN turbo prune @x/ws-gateway --docker

FROM base AS installer
WORKDIR /app
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile

FROM installer AS builder
WORKDIR /app
COPY --from=pruner /app/out/full/ .
RUN pnpm exec turbo run build --filter=@x/ws-gateway

FROM base AS runner
WORKDIR /app
RUN groupadd --system --gid 1001 nodeapp \
  && useradd --system --uid 1001 --gid nodeapp gatewayuser
COPY --from=builder --chown=gatewayuser:nodeapp /app .
USER gatewayuser
ENV NODE_ENV=production
EXPOSE 3002
WORKDIR /app/apps/ws-gateway
CMD ["node", "--import", "tsx/esm", "dist/server.js"]
