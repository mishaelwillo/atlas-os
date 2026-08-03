/**
 * Demo queue (docs/specs/p2/revenue-pilot.md).
 *
 * Acceptance: "Demo queue enforces 5–10 cap and QA/approval/expiry."
 *
 * The cap is the pilot's whole point of restraint. Ten concurrent demos is the
 * ceiling because each one is a real page built from a real business's facts,
 * and an operator has to stand behind every one of them. Five is the floor the
 * pilot needs to learn anything — below it the queue is reported as thin, but
 * a thin queue is not an error and never blocks work.
 *
 * State is `queued → building → qa → approved → shareable`, with `expired`
 * reachable from anything not yet shareable. Transitions only move forward:
 * a demo that failed QA goes back through the factory as a new build, not by
 * rewinding a row, so the history of what was attempted stays readable.
 *
 * Pure and deterministic — no clock, no database.
 */

/** Ceiling on demos in flight at once. */
export const DEMO_QUEUE_CAP = 10;
/** Floor the pilot needs to learn from; below it the queue is thin, not wrong. */
export const DEMO_QUEUE_FLOOR = 5;
/** How long a demo stays shareable before its sourced facts must be re-checked. */
export const DEMO_TTL_DAYS = 14;

export const DEMO_STATES = ['queued', 'building', 'qa', 'approved', 'shareable', 'expired'] as const;

export type DemoState = (typeof DEMO_STATES)[number];

/** States that occupy a slot against the cap. */
export const ACTIVE_DEMO_STATES: readonly DemoState[] = [
  'queued',
  'building',
  'qa',
  'approved',
  'shareable',
];

/** The single step permitted out of each state, before expiry is considered. */
const NEXT_STATE: Readonly<Record<DemoState, DemoState | null>> = {
  queued: 'building',
  building: 'qa',
  qa: 'approved',
  approved: 'shareable',
  shareable: null,
  expired: null,
};

export interface QueuedDemo {
  queueId: string;
  leadId: string;
  state: DemoState;
}

export type EnqueueRefusalCode =
  | 'not_qualified'
  | 'assessment_expired'
  | 'already_queued'
  | 'cap_reached';

export interface EnqueueRefusal {
  ok: false;
  code: EnqueueRefusalCode;
  message: string;
}

export interface EnqueuePlan {
  ok: true;
  /** Slots left after this one is taken. */
  remaining: number;
  /** True when the queue is still under the pilot floor; advisory only. */
  belowFloor: boolean;
}

export interface EnqueueInput {
  leadId: string;
  /** Verdict of the prospect's most recent assessment. */
  verdict: string | null;
  /** Whether that assessment has expired. */
  assessmentExpired: boolean;
  /** Demos currently occupying a slot, across the space. */
  active: readonly QueuedDemo[];
  cap?: number;
}

/**
 * Decide whether a prospect may take a demo slot.
 *
 * Qualification is checked here rather than trusted from the caller, because
 * the demo is the first thing a prospect ever sees of Atlas: building one for
 * a prospect nobody qualified is how an unvetted business ends up with a page
 * built from facts nobody checked.
 */
export function planEnqueue(input: EnqueueInput): EnqueuePlan | EnqueueRefusal {
  const cap = input.cap ?? DEMO_QUEUE_CAP;

  if (input.verdict !== 'qualified') {
    return {
      ok: false,
      code: 'not_qualified',
      message:
        input.verdict === null
          ? 'this prospect has no qualification assessment'
          : `this prospect is '${input.verdict}', not qualified`,
    };
  }
  if (input.assessmentExpired) {
    return {
      ok: false,
      code: 'assessment_expired',
      message: 'the qualification assessment has expired; re-assess before building a demo',
    };
  }
  if (input.active.some((d) => d.leadId === input.leadId)) {
    return {
      ok: false,
      code: 'already_queued',
      message: 'this prospect already occupies a demo slot',
    };
  }
  if (input.active.length >= cap) {
    return {
      ok: false,
      code: 'cap_reached',
      message: `the demo queue is at its cap of ${cap}; finish or expire one before adding another`,
    };
  }

  const remaining = cap - input.active.length - 1;
  return { ok: true, remaining, belowFloor: input.active.length + 1 < DEMO_QUEUE_FLOOR };
}

export type AdvanceRefusalCode = 'unknown_state' | 'terminal_state' | 'not_the_next_state';

export interface AdvanceRefusal {
  ok: false;
  code: AdvanceRefusalCode;
  message: string;
}

export interface AdvancePlan {
  ok: true;
  from: DemoState;
  to: DemoState;
}

/**
 * Decide whether a demo may move to a requested state.
 *
 * Only the single declared next step is allowed, or expiry. Letting a demo
 * jump from `queued` to `approved` would mean a page reached an owner without
 * passing the QA the factory gate exists to enforce.
 */
export function planAdvance(from: string, to: string): AdvancePlan | AdvanceRefusal {
  if (!isDemoState(from) || !isDemoState(to)) {
    return { ok: false, code: 'unknown_state', message: `'${from}' → '${to}' is not a known transition` };
  }
  if (from === 'expired' || from === 'shareable') {
    return {
      ok: false,
      code: 'terminal_state',
      message: `a '${from}' demo cannot move again; queue a new build instead`,
    };
  }
  // Expiry is reachable from anything still in flight: facts go stale wherever
  // the demo happens to have got to.
  if (to === 'expired') return { ok: true, from, to };

  const next = NEXT_STATE[from];
  if (next !== to) {
    return {
      ok: false,
      code: 'not_the_next_state',
      message: `a '${from}' demo may only become '${next ?? 'nothing'}' or 'expired'`,
    };
  }
  return { ok: true, from, to };
}

export function isDemoState(value: string): value is DemoState {
  return (DEMO_STATES as readonly string[]).includes(value);
}

/** When a demo queued at this moment stops being shareable. */
export function demoExpiry(queuedAt: Date, ttlDays = DEMO_TTL_DAYS): Date {
  return new Date(queuedAt.getTime() + ttlDays * 24 * 60 * 60 * 1000);
}
