# Atlas Drift Report

Generated control-plane collection is not installed yet.

## Initial verified drift

- Severity: blocking
- Environment: production
- Finding: Railway API still serves the P0 route set while P1 code is complete.
- Required resolution: deploy the selected P1 commit, verify its runtime fingerprint and required routes, then run live acceptance.

This bootstrap report is replaced by `pnpm control:status` once the observed-state collector is installed.
