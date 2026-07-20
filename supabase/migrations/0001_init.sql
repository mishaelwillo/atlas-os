-- ============================================================
-- ATLAS OS — 0001_init.sql
-- Core schema per ATLAS-OS-SPEC.md v1.2 (§3 architecture, §6 Intelligence Bank, §8 governance)
-- Authored in the Fable lane. Review gate: any change to RLS in this file requires Fable review.
-- Conventions: snake_case, uuid PKs, timestamptz, every privileged mutation audited.
-- ============================================================

create extension if not exists vector;        -- pgvector for answer_cache + memory_nodes embeddings
create extension if not exists pg_trgm;       -- trigram search assist

-- ---------- Tenancy ----------
-- A Space = one tenant (client site, app, venture). RLS scopes everything to a space.
create table spaces (
  space_id     uuid primary key default gen_random_uuid(),
  slug         text unique not null check (slug ~ '^[a-z0-9-]{2,40}$'),
  name         text not null,
  kind         text not null default 'app' check (kind in ('app','client-site','venture','system')),
  settings     jsonb not null default '{}',
  created_at   timestamptz not null default now()
);

-- Service accounts / API tokens (one per app or ingest agent; never the service-role key)
create table api_tokens (
  token_id     uuid primary key default gen_random_uuid(),
  space_id     uuid not null references spaces on delete cascade,
  label        text not null,
  token_hash   text not null,                 -- store sha256 only; plaintext shown once at creation
  scopes       text[] not null default '{}',  -- e.g. {memory:read, memory:write, events:write}
  disabled     boolean not null default false,
  last_used_at timestamptz,
  created_at   timestamptz not null default now()
);

-- ---------- Runs & governance (ported from db.cjs) ----------
create table runs (
  run_id       uuid primary key default gen_random_uuid(),
  space_id     uuid not null references spaces on delete cascade,
  capability   text not null,                 -- registry id, e.g. 'factory.build_site'
  task_class   text not null default 'do' check (task_class in ('think','do','quick')),
  model_used   text,
  status       text not null default 'queued'
               check (status in ('queued','review','running','succeeded','failed','cancelled')),
  input        jsonb not null default '{}',
  output       jsonb,
  tokens_in    integer not null default 0,
  tokens_out   integer not null default 0,
  cost_usd     numeric(10,4) not null default 0,
  answered_by  text check (answered_by in ('cache','playbook','nodes','model')), -- token-ladder rung (§6.5)
  created_at   timestamptz not null default now(),
  finished_at  timestamptz
);

create table run_logs (
  log_id       bigint generated always as identity primary key,
  run_id       uuid not null references runs on delete cascade,
  level        text not null default 'info' check (level in ('debug','info','warn','error')),
  message      text not null,
  detail       jsonb,
  created_at   timestamptz not null default now()
);

create table approvals (
  approval_id  uuid primary key default gen_random_uuid(),
  space_id     uuid not null references spaces on delete cascade,
  run_id       uuid references runs on delete set null,
  kind         text not null,                 -- outreach_send | deploy | spend | root_widen | truth_adjudication | ...
  reason       text not null,
  payload      jsonb not null default '{}',   -- what will happen if approved (rendered as declarative approval UI)
  status       text not null default 'pending'
               check (status in ('pending','approved','rejected','expired')),
  decided_by   text,
  decided_at   timestamptz,
  created_at   timestamptz not null default now()
);

create table audit_log (
  audit_id     bigint generated always as identity primary key,
  space_id     uuid references spaces on delete set null,
  actor        text not null,                 -- 'andrew' | token label | capability id
  action       text not null,
  target       text,
  detail       jsonb,
  created_at   timestamptz not null default now()
);

create table schedules (
  schedule_id  uuid primary key default gen_random_uuid(),
  space_id     uuid not null references spaces on delete cascade,
  capability   text not null,
  cron         text not null,
  input        jsonb not null default '{}',
  iteration_cap integer not null default 25, -- §8: loops always capped
  enabled      boolean not null default true,
  last_run_at  timestamptz,
  created_at   timestamptz not null default now()
);

-- ---------- Intelligence Bank (§6) ----------
-- L1: raw cards (verbatim, provenance)
create table memory_cards (
  card_id      uuid primary key default gen_random_uuid(),
  space_id     uuid references spaces on delete cascade,  -- null = studio-global
  title        text not null,
  body         text not null,
  source       text not null,                 -- 'drive:<path>' | 'omi' | 'obsidian' | 'run:<id>' | ...
  source_type  text not null default 'external'
               check (source_type in ('own-output','primary-doc','external','vendor-content')),
  tags         text[] not null default '{}',
  relevance_score integer not null default 0,
  score_reasons  text[] not null default '{}',
  content_hash text not null,                 -- sha256; incremental ingest skips unchanged
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index memory_cards_hash on memory_cards (coalesce(space_id,'00000000-0000-0000-0000-000000000000'::uuid), content_hash);
create index memory_cards_fts on memory_cards using gin (to_tsvector('english', title || ' ' || body));

-- L2: distilled knowledge graph (decision-memory per §6.0: kind field is mandatory)
create table memory_nodes (
  node_id      uuid primary key default gen_random_uuid(),
  space_id     uuid references spaces on delete cascade,
  kind         text not null check (kind in ('fact','decision','procedure','preference')),
  statement    text not null,                 -- atomic claim / decision + rationale
  entities     text[] not null default '{}',
  tags         text[] not null default '{}',
  confidence   real not null default 0.5 check (confidence between 0 and 1),
  truth_status text not null default 'hypothesis'
               check (truth_status in ('verified','probable','hypothesis','conflicted','stale','quarantined')),
  valid_until  timestamptz,                   -- TTL decay for fast-moving claims (§6.3)
  embedding    vector(384),                   -- local embedder; dimension fixed at bench time (P1 open item)
  sources      jsonb not null default '[]',   -- [{card_id, quote, source_type}]
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index memory_nodes_fts on memory_nodes using gin (to_tsvector('english', statement));
create index memory_nodes_embed on memory_nodes using ivfflat (embedding vector_cosine_ops) with (lists = 100);

create table memory_edges (
  edge_id      bigint generated always as identity primary key,
  from_node    uuid not null references memory_nodes on delete cascade,
  to_node      uuid not null references memory_nodes on delete cascade,
  relation     text not null,                 -- supports | contradicts | refines | derived-from | relates
  created_at   timestamptz not null default now(),
  unique (from_node, to_node, relation)
);

-- L3: playbooks (departing-genius SOPs) — versioned
create table playbooks (
  playbook_id  uuid primary key default gen_random_uuid(),
  space_id     uuid references spaces on delete cascade,
  slug         text not null,
  version      integer not null default 1,
  task_family  text not null,                 -- 'listing-classify' | 'site-descriptor' | 'audit-fix' | ...
  body         text not null,                 -- plain-language playbook + few-shot exemplars
  authored_by  text not null default 'fable', -- frontier author recorded
  stable_prefix boolean not null default true, -- byte-stable for KV-cache when true
  created_at   timestamptz not null default now(),
  unique (space_id, slug, version)
);

-- L3: semantic answer cache (§6.5 rung 1) — verified pattern
create table answer_cache (
  answer_id    uuid primary key default gen_random_uuid(),
  space_id     uuid references spaces on delete cascade,
  question     text not null,
  answer       text not null,
  embedding    vector(384) not null,
  verification text not null default 'unverified'
               check (verification in ('verified','unverified','spot-check-queued','failed')),
  hit_count    integer not null default 0,
  last_hit_at  timestamptz,
  source_run   uuid references runs on delete set null,
  created_at   timestamptz not null default now()
);
create index answer_cache_embed on answer_cache using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- Ingestion queue (local ingest agent pushes; incremental via hash)
create table ingest_queue (
  item_id      bigint generated always as identity primary key,
  space_id     uuid references spaces on delete cascade,
  source_path  text not null,
  content_hash text not null,
  status       text not null default 'pending'
               check (status in ('pending','admitted','rejected','distilled','error')),
  relevance_score integer,
  reject_reason  text,
  created_at   timestamptz not null default now(),
  processed_at timestamptz,
  unique (source_path, content_hash)
);

-- ---------- Website Factory (§5) ----------
create table sites (
  site_id      uuid primary key default gen_random_uuid(),
  space_id     uuid not null references spaces on delete cascade,
  business_name text not null,
  status       text not null default 'draft'
               check (status in ('draft','demo-ready','live','paused','churned')),
  descriptor   jsonb not null default '{}',   -- declarative site descriptor (template + style pack + content)
  template     text,
  style_pack   text,
  deploy_url   text,
  hosting_fee_usd numeric(8,2) not null default 0,
  source_profile jsonb not null default '{}', -- scraped GBP/FB facts used to build
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table leads (
  lead_id      uuid primary key default gen_random_uuid(),
  space_id     uuid not null references spaces on delete cascade,
  business_name text not null,
  gbp_url      text,
  phone        text,
  criteria     jsonb not null default '{}',   -- {active_gbp, no_website, reviews_count, ...}
  score        integer not null default 0,
  status       text not null default 'new'
               check (status in ('new','demo-built','contacted','replied','won','lost','suppressed')),
  site_id      uuid references sites on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table conversations (
  conversation_id uuid primary key default gen_random_uuid(),
  space_id     uuid not null references spaces on delete cascade,
  site_id      uuid references sites on delete set null,
  channel      text not null check (channel in ('form','chat','call','whatsapp','email','sms')),
  contact      jsonb not null default '{}',   -- {name, phone, email} as provided
  status       text not null default 'open' check (status in ('open','qualified','handed-off','closed','spam')),
  created_at   timestamptz not null default now()
);

create table messages (
  message_id   bigint generated always as identity primary key,
  conversation_id uuid not null references conversations on delete cascade,
  direction    text not null check (direction in ('inbound','outbound')),
  sender       text not null,                 -- 'visitor' | 'owner' | 'agent:<capability>'
  body         text not null,
  approved_by  uuid references approvals(approval_id), -- outbound agent messages REQUIRE an approval reference
  created_at   timestamptz not null default now()
);

-- ---------- Model Bench (§7) ----------
create table bench_results (
  result_id    bigint generated always as identity primary key,
  task_family  text not null,
  model        text not null,
  score        real not null,
  cost_usd     numeric(10,5) not null default 0,
  latency_ms   integer,
  notes        text,
  created_at   timestamptz not null default now()
);

-- ============================================================
-- RLS — deny by default; service key only in the API layer.
-- The API authenticates callers via api_tokens (sha256 compare) and sets
--   set_config('request.space_id', <uuid>, true)  per request.
-- Policies below scope by that setting. The Mission Control UI uses
-- Supabase Auth (Andrew = sole operator) with the 'operator' role claim.
-- ============================================================

alter table spaces         enable row level security;
alter table api_tokens     enable row level security;
alter table runs           enable row level security;
alter table run_logs       enable row level security;
alter table approvals      enable row level security;
alter table audit_log      enable row level security;
alter table schedules      enable row level security;
alter table memory_cards   enable row level security;
alter table memory_nodes   enable row level security;
alter table memory_edges   enable row level security;
alter table playbooks      enable row level security;
alter table answer_cache   enable row level security;
alter table ingest_queue   enable row level security;
alter table sites          enable row level security;
alter table leads          enable row level security;
alter table conversations  enable row level security;
alter table messages       enable row level security;
alter table bench_results  enable row level security;

-- Operator (Andrew, authenticated via Supabase Auth) sees everything.
create or replace function is_operator() returns boolean
language sql stable as $$
  select coalesce((auth.jwt() ->> 'email') = 'mobiledynamic876@gmail.com', false)
$$;

-- Request-scoped tenant check for API-token calls (API sets request.space_id per request)
create or replace function current_space() returns uuid
language sql stable as $$
  select nullif(current_setting('request.space_id', true), '')::uuid
$$;

-- Generic per-table policies: operator full access; token access scoped to its space.
do $$
declare t text;
begin
  foreach t in array array[
    'runs','run_logs','approvals','schedules','memory_cards','memory_nodes',
    'playbooks','answer_cache','ingest_queue','sites','leads','conversations','messages'
  ] loop
    execute format('create policy %I_operator on %I for all using (is_operator()) with check (is_operator());', t, t);
  end loop;
end $$;

create policy spaces_operator     on spaces     for all using (is_operator()) with check (is_operator());
create policy api_tokens_operator on api_tokens for all using (is_operator()) with check (is_operator());
create policy edges_operator      on memory_edges for all using (is_operator()) with check (is_operator());
create policy bench_operator      on bench_results for all using (is_operator()) with check (is_operator());

-- Space-scoped read/write for API-token requests (write NEVER includes approvals decisions or audit)
create policy runs_space   on runs   for all    using (space_id = current_space()) with check (space_id = current_space());
create policy cards_space  on memory_cards for all using (space_id = current_space() or space_id is null) with check (space_id = current_space());
create policy nodes_space  on memory_nodes for select using (space_id = current_space() or space_id is null);
create policy cache_space  on answer_cache for select using (space_id = current_space() or space_id is null);
create policy ingest_space on ingest_queue for insert with check (space_id = current_space());
create policy convo_space  on conversations for all using (space_id = current_space()) with check (space_id = current_space());
create policy msg_space    on messages for insert with check (
  exists (select 1 from conversations c where c.conversation_id = messages.conversation_id and c.space_id = current_space())
  and (direction = 'inbound' or approved_by is not null)  -- outbound requires approval reference. Non-negotiable.
);

-- audit_log: INSERT-only for everyone authenticated; no update/delete policies exist (immutable).
create policy audit_insert on audit_log for insert with check (true);
create policy audit_read_operator on audit_log for select using (is_operator());

-- approvals: tokens may INSERT requests but never decide them (no update policy for non-operator).
create policy approvals_request on approvals for insert with check (space_id = current_space() and status = 'pending');
