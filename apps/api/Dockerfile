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
RUN pnpm --filter @atlas/registry gen && \
    pnpm --filter @atlas/api... run build
# prune to production deps for @atlas/api (bundles workspace dist/ folders)
RUN pnpm --filter @atlas/api --prod deploy /out

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
