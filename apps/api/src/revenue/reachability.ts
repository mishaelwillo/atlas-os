/**
 * Can the product actually reach the states it declares?
 *
 * A transition table says what a state machine permits. That is a different
 * question from what any capability can ask for, and the two drift apart
 * silently: the hosting chain declared seven states while `hosting.activate`
 * hardcoded one target and nothing went further, so three were unreachable by
 * every caller — and `ENTITLED_STATES` named them, `planCancellation` branched
 * on them and the funnel's revenue SQL counted rows in them that no code path
 * could create. Nothing failed, because nothing asked.
 *
 * This is the general form of that question, asked of every revenue state
 * machine rather than the one where the gap was found. An unreachable state is
 * not automatically a defect — some are deferred on purpose — but an
 * unreachable state that nobody declared is, every time.
 *
 * Pure and deterministic: it walks declarations, touches no database and calls
 * no clock.
 */

/**
 * States are plain strings here rather than each machine's literal union.
 *
 * Every planner already takes `string` — they have to, because the values
 * arrive in request bodies — and a generic parameter would make the four
 * machines mutually unassignable, so nothing could walk them in one loop. What
 * a literal union would have caught, a deferred key naming a state the machine
 * does not have, is asserted in the test instead. That is the checkable
 * version of the same guarantee.
 */
export interface StateMachine {
  /** Named so a failure says which machine, not just which state. */
  name: string;
  states: readonly string[];
  /**
   * States a capability can put a *new* row into directly, with no transition
   * — the entrances. `hosting.record_terms` creates `terms_approved` or
   * `payment_pending`; `demos.enqueue` creates `queued`.
   *
   * An entry state that nothing inserts does not belong here. That is the
   * distinction the deal chain turns on: `interested` is where the planner
   * counts from, but no row is ever written carrying it.
   */
  entry: readonly string[];
  /**
   * Whether some capability can ask for this move — including a dispatcher
   * acting after an approval, which is still a path through the product.
   *
   * This must describe what the handlers do, so it lives beside the planner it
   * probes and is reviewed against them. It is deliberately not derived from
   * the transition table: the table permitting a move is exactly the thing
   * being cross-checked, and deriving one from the other would compare a
   * claim with itself.
   */
  canRequest: (from: string, to: string) => boolean;
  /**
   * Unreachable on purpose, each with the reason it is.
   *
   * A deferral with no reason is a to-do wearing a decision's clothes, so the
   * reason is required rather than optional.
   */
  deferred: Readonly<Record<string, string | undefined>>;
}

/** Every state a row in this machine can actually arrive in. */
export function reachableStates(machine: StateMachine): Set<string> {
  const reached = new Set<string>(machine.entry);
  for (;;) {
    const before = reached.size;
    for (const from of [...reached]) {
      for (const to of machine.states) {
        if (!reached.has(to) && machine.canRequest(from, to)) reached.add(to);
      }
    }
    if (reached.size === before) return reached;
  }
}

/**
 * States that are neither reachable nor declared unreachable.
 *
 * This is the finding. Everything else — reachable, or deferred with a stated
 * reason — is a state somebody decided about.
 */
export function unreachableUndeclared(machine: StateMachine): string[] {
  const reachable = reachableStates(machine);
  return machine.states.filter(
    (state) =>
      !reachable.has(state) &&
      !Object.prototype.hasOwnProperty.call(machine.deferred, state),
  );
}

/**
 * States declared unreachable that the product can in fact reach.
 *
 * The opposite error, and the one that gets worse with time: a deferral left
 * in place after the thing it was waiting for shipped reads as a limitation
 * the system no longer has.
 */
export function declaredButReachable(machine: StateMachine): string[] {
  const reachable = reachableStates(machine);
  return Object.keys(machine.deferred).filter((state) => reachable.has(state));
}
