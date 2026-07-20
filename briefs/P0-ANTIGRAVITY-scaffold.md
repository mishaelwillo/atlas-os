# BRIEF: P0 Monorepo Scaffold — Antigravity lane ($0)

**Paste this whole file into Antigravity as one task. It is self-contained — do not reference outside context. Work only inside `atlas-web/`. Do NOT modify: `supabase/migrations/*`, `packages/registry/registry.ts`, `SECURITY.md`, `briefs/*` (authored in another lane).**

## Goal
Scaffold a pnpm + Turborepo TypeScript monorepo that builds, runs locally, and deploys hello-world to Railway. No business logic — structure, configs, CI, and stubs only.

## Deliverables
1. **Root:** `package.json` (pnpm workspaces: `apps/*`, `packages/*`), `turbo.json` (build/dev/test/lint pipelines), `.gitignore` (node, dist, .env*), `.editorconfig`, `tsconfig.base.json` (strict, ES2022, moduleResolution bundler), `.env.example` listing: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `PORT`.
2. **apps/api** — Fastify 5 + TypeScript: `src/server.ts` (listens on `process.env.PORT ?? 3000`), `GET /healthz` → `{ ok: true, version }`, `GET /v1/status/mission_control` → static stub `{ ok: true, cards: [] }`; `@fastify/cors` restricted to the OS app origin env var; pino logging; `Dockerfile` (node:22-slim, multi-stage, non-root user).
3. **apps/os** — Vite + React 18 + TypeScript SPA: dark single-page shell titled "Atlas OS — Mission Control", left sidebar with the section names (Mission Control, Agents, Pipelines, Sites, Leads & Outreach, Conversations, Kanban, Memory, Model Bench, Approvals & Audit, Settings) as placeholder routes (react-router), a status card that fetches `/healthz` from the API URL env var and renders ok/fail. No component library; plain CSS modules; keep it minimal and fast.
4. **packages/client** — stub package exporting `createClient(baseUrl, token)` with one typed method `healthz()`. (Real codegen lands in another lane; just the package shape.)
5. **packages/shared** — empty types package (placeholder).
6. **CI:** `.github/workflows/ci.yml` — pnpm install, turbo build, turbo test on push/PR to main.
7. **README-scaffold.md** — how to run: `pnpm i`, `pnpm dev` (runs api + os concurrently), and Railway notes: two services from this repo — `apps/api` (Dockerfile) and `apps/os` (static build served via `serve` or Railway static), each with root directory set accordingly.

## Acceptance (run these; all must pass)
- `pnpm i && pnpm build` clean.
- `pnpm dev` → `curl localhost:3000/healthz` returns `{ok:true}`; OS app at :5173 shows the sidebar + green API status card.
- `docker build apps/api` succeeds.
- Tests: one vitest smoke test per app (api healthz handler; os renders sidebar) — `pnpm test` green.

## Style
Strict TS, no `any`, small files, no cleverness. Everything you add must build on Node 22.
