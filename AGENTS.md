# Atlas Model Entry Point

Before changing Atlas:

1. Read `docs/control/CONTROL_INDEX.md`.
2. Read `docs/control/CURRENT_HANDOFF.md`.
3. Run `pnpm control:status`.
4. Stop on any blocking drift.
5. Read only the active specification and its linked evidence.
6. Confirm the active work item and branch.

Before stopping:

1. Run the task's tests.
2. Run `pnpm control:verify`.
3. Update `docs/control/CURRENT_HANDOFF.md`.
4. Record external writes and the next exact action.
A merged handoff still names the branch it was written on, which blocks
`control:verify` on the integration branch. Archive it at the *start* of the
next session, before creating your own:

```
git checkout main && git pull --ff-only && pnpm control:archive-handoff
```

That rewrites the takeover point to name the integration branch, and the change
rides along in whatever branch you open next. Do not try to archive as a closing
step: the commit cannot be pushed to a protected branch, and recording the
integration branch from a feature branch would fail that branch's own CI.

Never put tokens, passwords, private keys, connection strings, or secret values in control artifacts.
