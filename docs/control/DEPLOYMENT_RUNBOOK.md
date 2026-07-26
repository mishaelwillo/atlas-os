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

## Secret handling

Record required variable names and the system that owns them. Never record variable values, tokens, passwords, private keys, connection strings, or copied environment files in control artifacts.

## Authority boundaries

- Git identifies implementation.
- GitHub Actions identifies CI state.
- Railway fingerprints identify deployed application versions.
- Supabase migrations and live verification identify database reality.

Differences are drift to investigate, not permission to overwrite one authority with another.
