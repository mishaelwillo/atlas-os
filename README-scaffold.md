# Atlas OS — P0 Monorepo Scaffold

This monorepo manages the backend API services and frontend OS rendering engines for the Atlas OS command center.

## Project Structure

- `apps/api/` — Fastify 5 + TypeScript backend service
- `apps/os/` — Vite + React 18 + TypeScript SPA frontend shell
- `packages/client/` — Type-safe API client stub
- `packages/shared/` — Common types placeholder
- `packages/registry/` — Central capabilities registry

## Prerequisites

- Node.js >= 22.0.0
- pnpm >= 9.0.0

## Getting Started

1. **Install Dependencies:**
   ```bash
   pnpm install
   ```

2. **Setup Environment Variables:**
   Copy the example env file and update the values:
   ```bash
   cp .env.example .env
   ```

3. **Run Services in Development:**
   Runs both `apps/api` and `apps/os` concurrently:
   ```bash
   pnpm dev
   ```
   - API Server: [http://localhost:3000](http://localhost:3000)
   - OS Shell UI: [http://localhost:5173](http://localhost:5173)

4. **Build Project Workspace:**
   Compiles all local packages and applications:
   ```bash
   pnpm build
   ```

5. **Run Tests:**
   Executes unit and integration smoke tests:
   ```bash
   pnpm test
   ```

## Railway Deployment Notes

This project can be deployed to Railway as two distinct services:

### 1. API Server (`apps/api`)
- **Source Repository:** This repository
- **Root Directory:** `apps/api`
- **Deployment Type:** Dockerfile (Railway automatically detects `apps/api/Dockerfile`)
- **Required Environment Variables:**
  - `PORT`: (Automatically assigned by Railway)
  - `SUPABASE_URL`: Your Supabase Project URL
  - `SUPABASE_SERVICE_ROLE_KEY`: Service role secret key
  - `OS_APP_ORIGIN`: The URL of your deployed `apps/os` frontend (for CORS restriction)

### 2. OS Shell Frontend (`apps/os`)
- **Source Repository:** This repository
- **Root Directory:** `apps/os`
- **Build Command:** `pnpm build`
- **Output Directory:** `dist`
- **Deployment Type:** Static site hosting
- **Required Environment Variables:**
  - `VITE_API_URL`: The URL of your deployed `apps/api` service (accessible by client browsers)
