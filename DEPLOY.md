# Atlas OS — P0 Deploy Card (exact settings)

Fable review-gate fixes applied to the Antigravity scaffold (verified: build 4/4, tests 6/6, API Docker path boots and returns `{"ok":true}`):
- `apps/api/Dockerfile` — now self-contained (builds inside the container; no committed `dist` needed).
- `apps/api/tsconfig.docker.json` — standalone build config (added).
- `apps/api/package.json` — removed unused `@atlas/shared` workspace dep that broke `npm install` in Docker.

## 1. Push the code (atlas-web = repo root)
```bash
cd "C:\Users\misha\Documents\New project 2\electron\atlas-web"
git init && git add -A
git commit -m "Atlas OS P0: scaffold + schema + registry + deploy fixes"
git branch -M main
git remote add origin https://github.com/mishaelwillo/atlas-os.git
git push -u origin main
```

## 2. Supabase (if not already run)
Supabase → SQL Editor → paste **all of** `supabase/migrations/0001_init.sql` → Run. Then Authentication → Providers → enable **Email** (OTP). Copy from Settings → API: Project URL, `anon` key, `service_role` key.

## 3. Railway — API service (`api-production-78a5`)
- **Root Directory:** `apps/api`
- **Builder:** Dockerfile (auto-detected at `apps/api/Dockerfile`)
- **Variables:**
  - `SUPABASE_URL` = `https://yyyspvralawnvhtmuyvg.supabase.co`
  - `SUPABASE_SERVICE_ROLE_KEY` = (from Supabase)
  - `OS_APP_ORIGIN` = `https://os-production-8faf.up.railway.app`
  - (`PORT` is injected by Railway — the Dockerfile respects it)
- **Verify:** open `https://api-production-78a5.up.railway.app/healthz` → `{"ok":true,"version":"0.1.0"}`

## 4. Railway — OS service (`os-production-8faf`)
The OS imports workspace packages, so it must build at the repo root. Use **Nixpacks (no Dockerfile)** with:
- **Root Directory:** `/` (repo root)
- **Build Command:**
  `npm i -g pnpm@9 && pnpm install && pnpm --filter @atlas/os build`
- **Start Command:**
  `pnpm dlx serve -s apps/os/dist -l $PORT`
- **Variables (build-time):**
  - `VITE_API_URL` = `https://api-production-78a5.up.railway.app`
- **Verify:** open `https://os-production-8faf.up.railway.app` on your phone → sidebar loads, API status card shows **green** (it's calling the API's `/healthz`).

## P0 exit criteria
- OS loads on your phone; API status card green (OS→API→CORS all wired).
- API `/healthz` and `/v1/status/mission_control` return ok.
- Supabase migration applied (tables + RLS live) — ready for the Codex lane to talk to.

## Then: P1
Paste `briefs/P1-CODEX-services.md` into Codex → real routes/router/scheduler/Mission Control + first approval round-trip through Supabase → back to Fable for the review gate.
