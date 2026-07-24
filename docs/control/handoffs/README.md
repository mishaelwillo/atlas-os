# Atlas Handoffs

The current handoff is mutable and unique. Archived handoffs are immutable.
Every model reads the current handoff after the control index and updates it
before stopping. A handoff must describe external state changes even when no
repository file changed.

`docs/control/CURRENT_HANDOFF.md` is the only active record. Run
`pnpm control:archive-handoff` before superseding it. The archive command uses a
deterministic UTC-date-and-ID filename, refuses collisions, and leaves the work
queue unchanged.
