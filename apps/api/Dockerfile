# Atlas OS — API service (Railway root directory = apps/api, Dockerfile deploy)
# Self-contained: builds inside the container so it does NOT depend on a
# committed dist/ or the monorepo build context. The API has no @atlas/*
# runtime deps, so a standalone tsc build is correct.

# ---- build stage ----
FROM node:22-slim AS build
WORKDIR /app
COPY package.json ./
# install runtime deps + a pinned typescript for the standalone build
# (api has no @atlas/* runtime deps, so plain npm resolves cleanly)
RUN npm install --omit=dev --no-audit --no-fund && \
    npm install --no-save --no-audit --no-fund typescript@5.4.5
COPY tsconfig.docker.json ./tsconfig.json
COPY src ./src
RUN npx tsc -p tsconfig.json

# ---- runtime stage ----
FROM node:22-slim AS runtime
RUN groupadd -g 10001 nodeapp && \
    useradd -u 10000 -g nodeapp -m -s /bin/bash nodeapp
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/dist ./dist
USER nodeapp
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
CMD ["node", "dist/server.js"]
