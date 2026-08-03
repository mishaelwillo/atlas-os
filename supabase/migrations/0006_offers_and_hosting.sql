-- ATLAS OS — 0006: offers, terms and hosting entitlement (P2C-REVENUE-001)
-- Owning specification: docs/specs/p2/revenue-pilot.md
--
-- REVIEW ONLY — NOT APPLIED at the time this file was committed. Applied state
-- is recorded in docs/control/ENVIRONMENTS.yaml (expected_migration), which is
-- the authority; this banner is not.
--
-- COUPLING: applying this requires bumping expected_migration to
-- 0006_offers_and_hosting, adding all three tables to required_tables, and
-- updating ATLAS_SCHEMA_VERSION on both Railway services — or the fingerprints
-- keep claiming 0005 and `pnpm control:status` reports blocking drift.
--
-- Strictly additive: three new tables plus indexes and policies. No existing
-- table, column, row or policy is altered.
--
-- NO PAYMENT CREDENTIALS. `billing.manage` is deferred to P3, so no provider is
-- integrated. `payment_reference` holds a reference an operator recorded from
-- the provider's own console and nothing else: no card number, no token, no
-- account credential. Stored payment credentials are an MVP exclusion.

-- ---------- offers ----------
-- Immutable and versioned per customer. An offer is never edited: a change is
-- a new version, because a business owner accepted a specific set of terms and
-- a price, and revising that in place would rewrite what they agreed to.
create table if not exists offers (
  offer_id      uuid primary key default gen_random_uuid(),
  space_id      uuid not null references spaces on delete cascade,
  lead_id       uuid not null references leads on delete cascade,
  version       integer not null,
  -- Terms are versioned per country and currency; there is no default for
  -- either, and no silent USD assumption.
  country       text not null check (country ~ '^[A-Z]{2}$'),
  currency      text not null check (currency ~ '^[A-Z]{3}$'),
  -- Minor units. Zero is a real price — the pitch is a free site with
  -- hosting-only payment — but absent is not, so this is NOT NULL.
  price_minor   integer not null check (price_minor >= 0),
  period        text not null check (period in ('monthly', 'yearly')),
  terms_version text not null,
  -- Disclosure key → the text shown to the owner. Every key the specification
  -- requires must be present before hosting can activate; the capability
  -- checks that, and the accepted row keeps what was actually disclosed.
  disclosures   jsonb not null default '{}',
  published_by  text not null,
  created_at    timestamptz not null default now(),
  unique (lead_id, version)
);

comment on table offers is
  'Immutable versioned offers. A change is a new version, never an edit.';
comment on column offers.disclosures is
  'What was actually shown to the owner, kept with the version they accepted.';

create index if not exists offers_space
  on offers (space_id, created_at desc);

alter table offers enable row level security;

-- Mirrors the space-scoped policy pattern established in 0001 for tenant data.
create policy offers_operator on offers
  for all using (is_operator()) with check (is_operator());
create policy offers_space on offers
  for select using (space_id = current_space());

-- ---------- deal decisions ----------
-- interested → discovery → offer_review → accepted|declined
-- Append-only: the latest row per lead is the standing decision, and the
-- history of how a deal moved is evidence the pilot's exit criteria need.
create table if not exists deal_decisions (
  decision_id   uuid primary key default gen_random_uuid(),
  space_id      uuid not null references spaces on delete cascade,
  lead_id       uuid not null references leads on delete cascade,
  state         text not null
                check (state in ('interested', 'discovery', 'offer_review', 'accepted', 'declined')),
  -- The specific offer version in front of the owner. Required to review or
  -- accept: accepting nothing in particular is the hidden-terms failure.
  offer_id      uuid references offers on delete restrict,
  offer_version integer,
  notes         text,
  -- Named human. Models cannot accept terms on anyone's behalf.
  decided_by    text not null,
  created_at    timestamptz not null default now()
);

create index if not exists deal_decisions_latest
  on deal_decisions (lead_id, created_at desc);

alter table deal_decisions enable row level security;

create policy deal_decisions_operator on deal_decisions
  for all using (is_operator()) with check (is_operator());
create policy deal_decisions_space on deal_decisions
  for select using (space_id = current_space());

-- ---------- hosting entitlement ----------
-- terms_approved → payment_pending → entitlement_active → onboarded → active
--                → past_due|cancelled
create table if not exists hosting_entitlements (
  entitlement_id uuid primary key default gen_random_uuid(),
  space_id       uuid not null references spaces on delete cascade,
  lead_id        uuid not null references leads on delete cascade,
  site_id        uuid references sites on delete set null,
  -- The offer version this entitlement serves. Activation requires the deal to
  -- have been accepted on this exact version: a customer who accepted last
  -- quarter's price must not be activated onto this quarter's.
  offer_id       uuid not null references offers on delete restrict,
  offer_version  integer not null,
  state          text not null default 'terms_approved'
                 check (state in ('terms_approved', 'payment_pending', 'entitlement_active',
                                  'onboarded', 'active', 'past_due', 'cancelled')),
  -- A reference an operator read off the provider's console. NOT a credential,
  -- NOT a card, NOT a token that can move money.
  payment_reference text,
  -- Cancellation disables renewal and deletes nothing.
  renewal_enabled   boolean not null default true,
  cancelled_at      timestamptz,
  -- A cancelled customer who paid for the period keeps it.
  serves_until      timestamptz,
  activated_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on column hosting_entitlements.payment_reference is
  'Provider reference recorded by an operator. Never a credential or card datum.';
comment on column hosting_entitlements.renewal_enabled is
  'Cancellation sets this false; it deletes no history, offer or export.';

-- One entitlement per lead that has not been cancelled. A cancelled one does
-- not occupy the slot, so a returning customer gets a fresh record rather than
-- a revived one.
create unique index if not exists hosting_entitlements_one_live_per_lead
  on hosting_entitlements (lead_id)
  where state <> 'cancelled';

create index if not exists hosting_entitlements_space
  on hosting_entitlements (space_id, state, created_at desc);

alter table hosting_entitlements enable row level security;

create policy hosting_entitlements_operator on hosting_entitlements
  for all using (is_operator()) with check (is_operator());
create policy hosting_entitlements_space on hosting_entitlements
  for select using (space_id = current_space());

-- The ledger is the control plane's only proof of schema identity. A migration
-- that does not self-record leaves the schema ahead of the ledger, and because
-- the drift check reads the ledger the mismatch is silent.
insert into supabase_migrations.schema_migrations (version, name)
values ('0006', 'offers_and_hosting')
on conflict (version) do nothing;
