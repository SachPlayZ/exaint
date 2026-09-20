# Multi-stage production build for Node 24 LTS
# Non-root user, healthcheck, production dependencies only (docs/06-ops-deploy.md §4)

FROM node:24-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

WORKDIR /app

# Dependencies stage
FROM base AS dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/protocol/package.json packages/protocol/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/

RUN pnpm install --frozen-lockfile

# Build stage for protocol and api
FROM dependencies AS builder
COPY tsconfig.base.json turbo.json ./
COPY packages/protocol packages/protocol
COPY apps/api apps/api
COPY apps/web apps/web

RUN pnpm --filter @repo/protocol build
RUN pnpm --filter @repo/api build
RUN pnpm --filter @repo/web build

# Production backend container (Fly.io / Docker Compose api)
FROM base AS api
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8080

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/protocol/package.json packages/protocol/
COPY apps/api/package.json apps/api/

RUN pnpm install --prod --frozen-lockfile

COPY --from=builder /app/packages/protocol/dist packages/protocol/dist
COPY --from=builder /app/apps/api/dist apps/api/dist

USER node

EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=3s --retries=3 \
  CMD node -e "fetch('http://localhost:' + (process.env.PORT || 8080) + '/healthz').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

CMD ["node", "apps/api/dist/index.js"]

# Production frontend container (Docker Compose web)
FROM base AS web
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/protocol/package.json packages/protocol/
COPY apps/web/package.json apps/web/

RUN pnpm install --prod --frozen-lockfile

COPY --from=builder /app/packages/protocol/dist packages/protocol/dist
COPY --from=builder /app/apps/web/.next apps/web/.next
COPY --from=builder /app/apps/web/public apps/web/public

USER node

EXPOSE 3000

CMD ["pnpm", "--filter", "@repo/web", "start"]
