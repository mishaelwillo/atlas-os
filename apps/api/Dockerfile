# Atlas OS — API service (P1). The API now depends on @atlas/{registry,router,
# scheduler}, so this is a pnpm MONOREPO build: set the Docker build context to
# the repo root (Railway: root directory = repo root, dockerfilePath =
# apps/api/Dockerfile). Same image serves the web process (dist/server.js) and
# the scheduler worker (dist/worker.js — set the start command per service).

# ---- build stage ----
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api
RUN pnpm install --frozen-lockfile --filter @atlas/api... --filter @atlas/registry
# api's own build runs codegen (pnpm run gen) before tsc, so no separate gen step.
RUN pnpm --filter @atlas/api... run build
# Prune to a self-contained runtime for @atlas/api (bundles the workspace dist/
# folders into node_modules/@atlas/*). --legacy is REQUIRED on pnpm v10+ (this
# repo pins pnpm@11): without it, deploy aborts with ERR_PNPM_DEPLOY_NONINJECTED_WORKSPACE
# and workspace deps (@atlas/router, @atlas/scheduler) are not bundled.
RUN pnpm --filter @atlas/api --prod --legacy deploy /out

# ---- runtime stage ----
FROM node:22-slim AS runtime
RUN groupadd -g 10001 nodeapp && \
    useradd -u 10000 -g nodeapp -m -s /bin/bash nodeapp
WORKDIR /app
COPY --from=build /out ./
USER nodeapp
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
CMD ["node", "dist/server.js"]
