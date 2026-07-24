# Atlas Handoffs

The current handoff is mutable and unique. Archived handoffs are immutable.
Every model reads the current handoff after the control index and updates it
before stopping. A handoff must describe external state changes even when no
repository file changed.

`docs/control/CURRENT_HANDOFF.md` is the only active record. Run
`pnpm control:archive-handoff` before superseding it. The archive command uses a
deterministic UTC-date-and-ID filename, refuses a collision whose contents
differ, and safely resumes when a retry finds a byte-identical archive. It
leaves the work queue unchanged.

The create command accepts repeatable `--task-change`, `--evidence`,
`--database-action`, `--hosting-action`, `--side-effect`, and `--blocker`
arguments. Values are preserved as supplied after single-line secret-safe
validation. Omitted evidence and blockers render as `Not supplied.`; omitted
database, hosting, and side-effect actions render as
`No external action reported.`. Generated observed state contributes only its
validated status, collection time, and provenance mode—not raw values, errors,
connections, or credentials.
