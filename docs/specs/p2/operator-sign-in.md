# Operator Sign-In and Space Selection

## Purpose

Give the operator a real authenticated session in Atlas OS instead of pasting a
hand-obtained JWT, and let that session name the Space it is acting in, so
governed capabilities can actually be exercised from the UI.

This specification owns operator session state in `apps/os`. It does not change
any capability contract, route, scope, or approval rule. Authentication remains
Supabase Auth and authorization remains `is_operator()` plus the existing scope
gate.

## Problem this solves

Two verified defects block the P1 approval round trip from the UI.

1. **No sign-in exists.** `apps/os/src/MissionControl.tsx` reads a raw string
   from `localStorage` under `atlas.token` and renders a text input labelled
   `operator JWT / api token`. There is no login screen, no session, and no
   refresh. Obtaining a session token requires calling the Supabase Auth REST
   endpoint by hand, which means handling the operator password outside the
   product.
2. **No Space is ever sent.** `MissionControl.tsx` constructs the generated
   client with a base URL and an authorization credential only; it never
   supplies `spaceId`. `apps/api/src/pipeline.ts` rejects any `requiresApproval`
   capability when `auth.spaceId` is null with
   `approval-gated capability requires a space (x-atlas-space)`. So even a valid
   operator session cannot create an approval today — `outreach.send`,
   `memory.adjudicate`, `factory.deploy_site`, and `playbooks.author` all fail
   with 400 before reaching the approval path.

Fixing only the first leaves the acceptance test still blocked. Both are in
scope here.

## Users

The pinned operator is the only interactive human. Agents and services continue
to authenticate with scoped API tokens and never use this flow.

## Inputs and outputs

Inputs: operator email and password (or a magic link), and a selected Space.
Outputs: an authenticated session with a current access token, a resolved Space
id sent as `x-atlas-space`, and a visible session state the operator can trust.

## UI and menu

- **Signed out:** a sign-in view. Email and password fields, submit, and an
  inline error region. No other Mission Control content renders.
- **Signed in:** the existing Mission Control cards, plus a session bar showing
  the signed-in email, the active Space, and a sign-out control.
- **Space selector:** a picker listing Spaces the session may act in. The
  selection persists across reloads and is shown at all times, because it
  silently changes what every governed action applies to.
- **Advanced, API tokens.** The existing paste field, retained but demoted
  behind a disclosure. It is how an operator reproduces agent-scoped behaviour,
  and removing it would lose real diagnostic capability.

## Workflow and states

Session: `signed_out → authenticating → signed_in → expiring → refreshed`, with
`sign_in_failed` and `expired` branches returning to `signed_out`.

Space: `none → selected`, persisted per operator. A governed action attempted
while `none` is blocked in the client with an explanatory message rather than
being sent and rejected by the API.

Sign-out clears the session, the cached Space, and any stored credential
material, then returns to `signed_out`.

## Data entities

No new database entity. The session is client-side only. `auth.users` is the
identity source and is currently **empty** — the operator account does not yet
exist and must be created before this flow can succeed.

Space options come from the existing `spaces` table via an authenticated read.
Both the API guard (`operatorEmail` in `apps/api/src/env.ts`) and the database
policy (`is_operator()` in `supabase/migrations/0001_init.sql`) pin the operator
by **email**, not by user id, so an account created later matches without any
identifier reconciliation.

## APIs, events, and integrations

Sign-in uses Supabase Auth directly from the browser with the existing
`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` build variables, which are
already configured on the `os` service. No Atlas API route is added or changed.

The resulting access token is sent in the Authorization header on
generated-client calls exactly as the pasted value is today, and the selected
Space is sent as `x-atlas-space`.

Listing Spaces needs an authenticated read. There is no `spaces.list`
capability in the registry, so the MVP reads the `spaces` table through
Supabase with the operator session, where `spaces_operator` RLS already
restricts access to the pinned operator. Introducing a registry capability for
this is deferred, not assumed.

### Dependency decision

Use `@supabase/supabase-js` in `apps/os`. It is not currently a dependency.

The alternative is hand-rolled `fetch` against the Auth REST API, which avoids
a dependency but requires implementing refresh-token rotation, expiry
scheduling, and cross-tab session sync by hand. Those are the parts most likely
to be written subtly wrong, and getting them wrong logs the operator out
mid-approval or, worse, leaves a stale token in storage. The SDK is the
intended design — the anon key and project URL are already wired into the
service for exactly this.

## Permissions, approvals, and autonomy

Unchanged. A session for any address other than the pinned operator email is
refused by the API and by every RLS policy; the UI must surface that as a clear
"not the pinned operator" state rather than a generic failure. Approval-gated
capabilities still create an approval and still require a separate decision.
This specification grants no new autonomy.

## Regional behavior

None. Operator sign-in is global and is not region-scoped.

## Entitlement and monetization

Platform/operations. Not a customer-facing entitlement and not billable.

## Evidence

Repository code is the authority for the two defects above: the token hook and
client construction in `apps/os/src/MissionControl.tsx`, the space guard in
`apps/api/src/pipeline.ts`, the operator guard in `apps/api/src/env.ts`, and
`is_operator()` in `supabase/migrations/0001_init.sql`. The empty `auth.users`
table was observed by a read-only query on 2026-07-27.

## Analytics

Sign-in success and failure counts, refresh failures, session length, time from
load to first successful governed call, and how often a governed action is
blocked for having no Space selected.

## Errors and recovery

- Wrong credentials: inline message, no session state change, no lockout claim
  the product cannot enforce.
- Correct credentials but non-operator email: explicit "not the pinned
  operator", because this is a policy outcome and not a typo.
- An expired access token refreshes silently; if refresh fails, return to
  `signed_out` preserving any unsaved input and say the session expired.
- Missing Space on a governed action: block client-side with a message naming
  the Space requirement.
- Supabase unreachable: state that identity is unavailable. Never fall back to
  an unauthenticated or assumed-operator mode.

## Security and privacy

- The operator session carries `scopes: ['*']` and satisfies `is_operator()`,
  so it is the highest-privilege credential in the system. Any script injected
  into this origin can read it and approve outreach. That blast radius is the
  reason the items below are requirements rather than suggestions.
- Never render untrusted or memory-sourced content as HTML in an authenticated
  view. Memory cards contain ingested third-party text and are a prompt- and
  script-injection surface.
- The password is entered only into the Supabase Auth call and is never stored,
  logged, or placed in application state.
- Session material lives in the SDK's storage. Sign-out must clear it, and the
  legacy `atlas.token` key must be removed on upgrade so an old pasted
  credential cannot outlive the change.
- No credential value appears in logs, telemetry, URLs, or control artifacts.
- Sessions expire on the Supabase default (about one hour) and are refreshed;
  expiry is never extended locally.

## MVP exclusions

No multi-user accounts, roles, invitations, or per-user permissions — the
system pins exactly one operator by email. No OAuth or SSO providers. No
password reset flow in-product. No server-side session or cookie-based auth. No
Space creation or editing from this view. No impersonation.

## Acceptance tests

- Signing in with the pinned operator email and a correct password reaches
  `signed_in`, and Mission Control status cards load.
- Signing in with a valid non-operator account is refused with the pinned
  operator message and reaches no privileged state.
- Wrong credentials produce an inline error and no session.
- A selected Space is sent as `x-atlas-space`, and `outreach.send` from the UI
  returns an `approvalId` with status `review` instead of the 400 space error.
- Approving that item causes the dispatcher to fire and writes an
  `outreach.dispatched` audit row, while the message remains unsent because the
  sender is a log-only stub.
- With no Space selected, a governed action is blocked before any request is
  sent.
- An expired access token refreshes without interrupting the operator; a failed
  refresh returns to `signed_out` with an explicit expiry message.
- Sign-out clears the session and the legacy `atlas.token` key, and reloading
  does not restore access.

## Progressive integration

- **build now:** email/password sign-in, session persistence and refresh,
  sign-out, Space selection, and the retained API-token path.
- **integrate now:** `@supabase/supabase-js` in `apps/os`.
- **build later:** a registry `spaces.list` capability so the UI stops reading
  the table directly, and magic-link sign-in.
- **exclude pending evidence:** multi-user roles, SSO, and any server-side
  session model. None has a demonstrated need while exactly one operator is
  pinned by email.

## Prerequisite

The operator account must exist in Supabase Auth before this flow can succeed.
`auth.users` currently has no rows. Creating it is an administrative action
performed in the Supabase dashboard with the address pinned in
`apps/api/src/env.ts` and `is_operator()`.
