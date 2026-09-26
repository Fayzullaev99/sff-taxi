# syntax=docker/dockerfile:1
# One image for the API, the worker (outbox, dispatch loop, housekeeping) and the migration job:
#   docker run IMAGE                                   -> API on :3200 (default)
#   docker run IMAGE node dist/worker.js               -> worker, health/metrics on :3201
#   docker run IMAGE node dist/core/db/migrate.cli.js  -> migrations (DATABASE_MIGRATION_URL)
# Debian slim rather than Alpine: glibc builds of native modules (SWC, esbuild) are the safe path.

ARG NODE_IMAGE=node:24-bookworm-slim

FROM ${NODE_IMAGE} AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
RUN --mount=type=cache,target=/root/.npm \
    npm ci --workspace apps/api --include-workspace-root --no-audit --no-fund
COPY apps/api apps/api
RUN npm run build -w apps/api

FROM ${NODE_IMAGE} AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
RUN --mount=type=cache,target=/root/.npm \
    npm ci --workspace apps/api --omit=dev --no-audit --no-fund

FROM ${NODE_IMAGE}
ARG APP_RELEASE=""
# APP_RELEASE tags Sentry events; empty is treated as unset by the app
ENV NODE_ENV=production \
    APP_RELEASE=${APP_RELEASE} \
    PORT=3200 \
    WORKER_HTTP_PORT=3201
WORKDIR /app
# workspace dependencies are hoisted to the repository root node_modules
COPY --from=deps --chown=root:root /repo/node_modules ./node_modules
COPY --from=build --chown=root:root /repo/apps/api/dist ./dist
COPY --chown=root:root apps/api/migrations ./migrations
# "type": "module": dist is ES modules
COPY --chown=root:root apps/api/package.json ./package.json
# code is root-owned and read-only for the runtime user
USER node
EXPOSE 3200 3201
# HEALTH_PORT lets the worker (3201) reuse this check; the migrate job disables it
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.HEALTH_PORT||process.env.PORT||3200)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "dist/main.js"]
