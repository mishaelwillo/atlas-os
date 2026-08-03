# Atlas Deployment Runbook

## Safe production sequence

1. Select the exact Git SHA and verify that it is reachable from `main`.
2. Verify that the latest relevant CI run concluded successfully for that exact SHA.
3. Deploy the API and OS separately.
4. Read each service's runtime fingerprint.
5. Run route probes.
6. Run live acceptance.
7. Update `CURRENT_HANDOFF.md` with evidence and remaining caveats.

Stop when any step fails. Do not describe the deployment as complete until fingerprints, route probes, and acceptance all pass.

## Database migrations

Every migration file must record itself in the ledger as its final statement:

```sql
insert into supabase_migrations.schema_migrations (version, name)
values ('000N', 'migration_name')
on conflict (version) do nothing;
```

The ledger is the control plane's only proof of schema identity. Applying a
migration that does not self-record leaves the schema ahead of the ledger, and
because the drift check reads the ledger, the mismatch is silent: drift looks
clean while `expected_migration` describes a schema that is no longer deployed.
This happened with `0003_site_deployments`, which was applied by hand and left
the ledger a version behind.

Bump `expected_migration` in `ENVIRONMENTS.yaml` in the same approved change,
and update `ATLAS_SCHEMA_VERSION` on both services so their fingerprints stop
claiming the previous schema.

A migration file must not say whether it has been applied. `expected_migration`
in `ENVIRONMENTS.yaml` is the authority, and the drift collector compares it
against the live ledger; a file cannot know its own history. Every migration
here once carried a `REVIEW ONLY — NOT APPLIED` banner, and every one became
false the moment it ran — `0002` through `0006` all shipped saying no database
had run them. Keeping such a banner current is a manual step that failed, so
the claim is banned rather than maintained: `control:verify` fails with
`control.migration_claims_applied_state` on any applied-state assertion in a
migration comment, in either direction.

`0001_init.sql` is immutable. An applied migration is immutable too: correct a
mistake with a new migration, never by editing one that has run. That rule
protects what executes. Removing those false banners changed comment lines
only — the non-comment content of each file hashes identically before and
after — and nothing may edit a statement in a migration that has run.

## Secret handling

Record required variable names and the system that owns them. Never record variable values, tokens, passwords, private keys, connection strings, or copied environment files in control artifacts.

## Authority boundaries

- Git identifies implementation.
- GitHub Actions identifies CI state.
- Railway fingerprints identify deployed application versions.
- Supabase migrations and live verification identify database reality.

Differences are drift to investigate, not permission to overwrite one authority with another.
