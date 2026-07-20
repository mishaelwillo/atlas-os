# Atlas OS — web app (P0)

The studio's generic AI backend / Agent OS. Spec: `../ATLAS-OS-SPEC.md` (v1.2). Vetted build plan: Fable = judgment/security/review, Codex 5.6 = bulk implementation, Antigravity = scaffold/tests ($0). Delegation happens at task boundaries via `briefs/`.

## What's here now (Fable lane, done)
- `supabase/migrations/0001_init.sql` — full schema: tenancy (spaces + scoped api_tokens), runs/approvals/audit/schedules, Intelligence Bank (cards → decision-memory nodes/edges → playbooks + answer cache + ingest queue), Website Factory (sites/leads/conversations/messages), Model Bench. RLS: deny-by-default, operator full, tokens space-scoped; outbound messages structurally require an approval reference.
- `packages/registry/registry.ts` — the capability registry (single source of truth; routes + client are codegen'd from it).
- `SECURITY.md` — the invariants. Read it before touching anything.
- `briefs/P0-ANTIGRAVITY-scaffold.md` — paste into Antigravity now.
- `briefs/P1-CODEX-services.md` — paste into Codex after the scaffold passes acceptance.

## Provisioning (Andrew, ~15 min, in order)
1. **GitHub:** create empty repo `atlas-os`, then from this folder: `git init && git add -A && git commit -m "P0: schema, registry, security, briefs" && git remote add origin <repo-url> && git push -u origin main`.
2. **Supabase:** create project (free) → SQL editor → paste `supabase/migrations/0001_init.sql` → run. Auth → enable email OTP. Copy Project URL + anon key + service-role key.
3. **Railway:** New Project → Deploy from the GitHub repo (after the Antigravity scaffold lands so there's something to build). Two services: `apps/api` (Dockerfile; env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PORT) and `apps/os` (static build; env: VITE_API_URL).

## Order of operations
1. You provision GitHub + Supabase (above).
2. Run the **Antigravity brief** → push → connect Railway → hello-world live (P0 exit: Mission Control loads on your phone).
3. Run the **Codex brief** → services + real Mission Control.
4. Back to me (Fable) for the review gate on both lanes' output, then P1 memory playbooks.

## P0 exit criteria
Mission Control loads from Railway on your phone; one approval round-trips through Supabase; audit rows written.
