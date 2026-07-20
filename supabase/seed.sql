-- Atlas OS — seed.sql : create the first Space + a scoped API token.
-- Run in Supabase SQL editor AFTER 0001_init.sql. Idempotent.
--
-- SECURITY: api_tokens stores only the sha256 hash. The plaintext token is
-- what an app/agent sends as `Authorization: Bearer <token>`. Generate the
-- plaintext yourself, hash it here, and store the plaintext in Railway env /
-- your password manager — it is never recoverable from the DB.
--
-- 1) Pick a plaintext token (example generator, run locally, do NOT reuse this one):
--       openssl rand -hex 32
--    Suppose it is:  atlas_live_<64hexchars>
-- 2) Put that plaintext in the :token psql var below (or inline the sha256).

-- ---- studio-global system space (space_id NULL memory is studio-wide) ----
insert into spaces (slug, name, kind)
values ('studio', 'Studio (system)', 'system')
on conflict (slug) do nothing;

-- ---- first app space: the Atlas OS control plane itself ----
insert into spaces (slug, name, kind)
values ('atlas', 'Atlas OS', 'app')
on conflict (slug) do nothing;

-- ---- an ingest-agent token scoped to the atlas space ----
-- Replace the digest below with:  encode(digest('<your-plaintext-token>','sha256'),'hex')
-- Easiest: run this whole statement with your token substituted.
insert into api_tokens (space_id, label, token_hash, scopes)
select s.space_id,
       'local-ingest-agent',
       encode(digest('REPLACE_WITH_YOUR_PLAINTEXT_TOKEN', 'sha256'), 'hex'),
       array['memory:write','memory:read']
from spaces s
where s.slug = 'atlas'
on conflict do nothing;

-- Verify:
--   select slug, kind from spaces;
--   select label, scopes, disabled from api_tokens;
--
-- The digest() function needs pgcrypto; enable if the insert errors:
--   create extension if not exists pgcrypto;
