/**
 * Outreach sequence state (docs/specs/p2/revenue-pilot.md).
 *
 * The specification is unambiguous about what a sequence may and may not do:
 * `automation.sequence` "plans state but cannot bypass per-touch checks", and
 * every touch is "separately eligible, capped, approved, audited, and stopped
 * on reply/opt-out/complaint".
 *
 * So nothing here sends anything, and nothing here can put a touch into `sent`.
 * A sequence is a plan plus a record of what happened to it. The only path to
 * `sent` is the existing approval-gated `outreach.send` dispatcher, and the
 * only path to `approved` is a real approvals row — a sequence that could
 * advance itself past those would be exactly the autonomous cold outreach the
 * MVP excludes.
 *
 * Pure and deterministic — no clock, no database.
 */

/** Touch states, in the order the specification lists them. */
export const TOUCH_STATES = [
  'draft',
  'policy_check',
  'approval_required',
  'approved',
  'scheduled',
  'sent',
  'delivered',
  'failed',
  'replied',
  'no_reply',
  'suppressed',
] as const;

export type TouchState = (typeof TOUCH_STATES)[number];

export const SEQUENCE_STATES = ['planned', 'active', 'stopped', 'completed'] as const;

export type SequenceState = (typeof SEQUENCE_STATES)[number];

/** Minimum gap between one touch being sent and the next becoming eligible. */
export const MIN_TOUCH_SPACING_HOURS = 48;

/** Where a touch may go next. Terminal states map to an empty list. */
const NEXT_TOUCH_STATES: Readonly<Record<TouchState, readonly TouchState[]>> = {
  draft: ['policy_check'],
  policy_check: ['approval_required'],
  approval_required: ['approved'],
  approved: ['scheduled'],
  scheduled: ['sent'],
  sent: ['delivered', 'failed'],
  // A delivered touch is waiting on the recipient; they decide what happens.
  delivered: ['replied', 'no_reply', 'suppressed'],
  failed: [],
  replied: [],
  no_reply: [],
  suppressed: [],
};

/** States in which a touch is finished and cannot move again. */
export const TERMINAL_TOUCH_STATES: readonly TouchState[] = [
  'failed',
  'replied',
  'no_reply',
  'suppressed',
];

/**
 * Outcomes that stop the whole sequence.
 *
 * A reply means a human is talking to us and the plan is no longer the right
 * thing to follow. Suppression means they asked us to stop. Both end the
 * sequence rather than advancing it, which is the specification's "stopped on
 * reply/opt-out/complaint".
 */
export const STOPPING_TOUCH_STATES: readonly TouchState[] = ['replied', 'suppressed'];

export function isTouchState(value: string): value is TouchState {
  return (TOUCH_STATES as readonly string[]).includes(value);
}

export function isTerminal(state: TouchState): boolean {
  return TERMINAL_TOUCH_STATES.includes(state);
}

export function stopsSequence(state: TouchState): boolean {
  return STOPPING_TOUCH_STATES.includes(state);
}

export interface PlannedStep {
  step: number;
  channel: string;
}

export type PlanRefusalCode =
  | 'no_steps'
  | 'too_many_steps'
  | 'unknown_channel'
  | 'repeated_channel'
  | 'sequence_already_open';

export interface PlanRefusal {
  ok: false;
  code: PlanRefusalCode;
  message: string;
}

export interface SequencePlan {
  ok: true;
  steps: PlannedStep[];
}

/**
 * Channels a touch may be planned on.
 *
 * Region packs carry `preferred_channels`, but the specification says in terms
 * that North American SMS and Caribbean WhatsApp preference "are availability
 * hints, not permission". So preference does not gate anything here; what gates
 * a touch is the approval it cannot be sent without.
 */
export const OUTREACH_CHANNELS = ['email', 'sms', 'whatsapp', 'social_dm', 'phone'] as const;

/** The presenter's sequence is at most this long; more is aggressive frequency. */
export const MAX_SEQUENCE_STEPS = 4;

/**
 * Plan a sequence of touches for one lead.
 *
 * A channel may appear once. Repeating a channel is how a sequence turns into
 * the same message sent again, which the specification excludes as aggressive
 * frequency rather than treating as a cadence choice.
 */
export function planSequence(args: {
  channels: readonly string[];
  /** Whether this lead already has a sequence that has not stopped. */
  openSequence: boolean;
}): SequencePlan | PlanRefusal {
  if (args.openSequence) {
    return {
      ok: false,
      code: 'sequence_already_open',
      message: 'this lead already has a sequence that has not stopped or completed',
    };
  }
  if (args.channels.length === 0) {
    return { ok: false, code: 'no_steps', message: 'a sequence needs at least one touch' };
  }
  if (args.channels.length > MAX_SEQUENCE_STEPS) {
    return {
      ok: false,
      code: 'too_many_steps',
      message: `a sequence may plan at most ${MAX_SEQUENCE_STEPS} touches`,
    };
  }

  const unknown = args.channels.filter(
    (c) => !(OUTREACH_CHANNELS as readonly string[]).includes(c),
  );
  if (unknown.length > 0) {
    return {
      ok: false,
      code: 'unknown_channel',
      message: `unknown channels: ${unknown.join(', ')}`,
    };
  }
  if (new Set(args.channels).size !== args.channels.length) {
    return {
      ok: false,
      code: 'repeated_channel',
      message: 'each channel may carry at most one touch in a sequence',
    };
  }

  return {
    ok: true,
    steps: args.channels.map((channel, index) => ({ step: index + 1, channel })),
  };
}

export type AdvanceRefusalCode =
  | 'sequence_stopped'
  | 'unknown_state'
  | 'touch_terminal'
  | 'not_a_permitted_transition'
  | 'approval_required'
  | 'send_not_self_serviceable';

export interface TouchAdvanceRefusal {
  ok: false;
  code: AdvanceRefusalCode;
  message: string;
}

export interface TouchAdvancePlan {
  ok: true;
  from: TouchState;
  to: TouchState;
  /** True when this outcome ends the whole sequence. */
  stopsSequence: boolean;
}

export interface TouchAdvanceInput {
  sequenceState: string;
  from: string;
  to: string;
  /** An approvals row id, when one justifies the move. */
  approvalId: string | null;
  /**
   * Set only by the `outreach.send` dispatcher. A sequence caller can never
   * assert this, which is what keeps sending on the approval-gated path.
   */
  viaDispatcher?: boolean;
}

/**
 * Decide whether one touch may move.
 *
 * Two transitions are special and both are about the same thing — a sequence
 * must not be able to walk itself into an outbound message:
 *
 * - `approval_required → approved` needs a real approvals row.
 * - `scheduled → sent` is refused outright unless the `outreach.send`
 *   dispatcher is what is asking. Recording a touch as sent when nothing was
 *   sent would make the audit trail claim an external effect that never
 *   happened; doing it *before* an approval would be worse.
 */
export function planTouchAdvance(input: TouchAdvanceInput): TouchAdvancePlan | TouchAdvanceRefusal {
  if (input.sequenceState === 'stopped' || input.sequenceState === 'completed') {
    return {
      ok: false,
      code: 'sequence_stopped',
      message: `the sequence is '${input.sequenceState}'; no further touch may move`,
    };
  }
  if (!isTouchState(input.from) || !isTouchState(input.to)) {
    return {
      ok: false,
      code: 'unknown_state',
      message: `'${input.from}' → '${input.to}' is not a known touch transition`,
    };
  }
  if (isTerminal(input.from)) {
    return {
      ok: false,
      code: 'touch_terminal',
      message: `a '${input.from}' touch is finished and cannot move again`,
    };
  }
  if (!NEXT_TOUCH_STATES[input.from].includes(input.to)) {
    return {
      ok: false,
      code: 'not_a_permitted_transition',
      message: `a '${input.from}' touch may only become ${NEXT_TOUCH_STATES[input.from].join(' or ')}`,
    };
  }
  if (input.to === 'approved' && (input.approvalId === null || input.approvalId.trim() === '')) {
    return {
      ok: false,
      code: 'approval_required',
      message: 'a touch becomes approved only against a recorded approval',
    };
  }
  if (input.to === 'sent' && input.viaDispatcher !== true) {
    return {
      ok: false,
      code: 'send_not_self_serviceable',
      message: 'only the approved outreach.send dispatch may record a touch as sent',
    };
  }

  return { ok: true, from: input.from, to: input.to, stopsSequence: stopsSequence(input.to) };
}

export interface TouchRecord {
  touchId: string;
  step: number;
  channel: string;
  state: TouchState;
  /** When this touch was sent, if it was. */
  sentAt: string | null;
}

export type NextTouchRefusalCode =
  | 'sequence_stopped'
  | 'touch_in_flight'
  | 'spacing_not_elapsed'
  | 'sequence_exhausted';

export interface NextTouchRefusal {
  ok: false;
  code: NextTouchRefusalCode;
  message: string;
}

export interface NextTouch {
  ok: true;
  touchId: string;
  step: number;
  channel: string;
}

/**
 * Which touch, if any, is eligible to be drafted next.
 *
 * Only one touch may be in flight at a time. If two could run at once, "each
 * touch is separately eligible, capped and approved" stops meaning anything —
 * a reply to the first would arrive after the second had already gone out.
 */
export function nextEligibleTouch(args: {
  sequenceState: string;
  touches: readonly TouchRecord[];
  now: Date;
  spacingHours?: number;
}): NextTouch | NextTouchRefusal {
  if (args.sequenceState === 'stopped' || args.sequenceState === 'completed') {
    return {
      ok: false,
      code: 'sequence_stopped',
      message: `the sequence is '${args.sequenceState}'`,
    };
  }

  const ordered = [...args.touches].sort((a, b) => a.step - b.step);
  const inFlight = ordered.find((t) => t.state !== 'draft' && !isTerminal(t.state));
  if (inFlight) {
    return {
      ok: false,
      code: 'touch_in_flight',
      message: `step ${inFlight.step} is '${inFlight.state}'; only one touch may be in flight`,
    };
  }

  const pending = ordered.find((t) => t.state === 'draft');
  if (!pending) {
    return {
      ok: false,
      code: 'sequence_exhausted',
      message: 'every planned touch has been resolved',
    };
  }

  const spacingHours = args.spacingHours ?? MIN_TOUCH_SPACING_HOURS;
  const lastSent = ordered
    .filter((t) => t.sentAt !== null)
    .map((t) => Date.parse(t.sentAt as string))
    .filter((t) => !Number.isNaN(t))
    .sort((a, b) => b - a)[0];

  if (lastSent !== undefined) {
    const elapsedHours = (args.now.getTime() - lastSent) / 3_600_000;
    if (elapsedHours < spacingHours) {
      return {
        ok: false,
        code: 'spacing_not_elapsed',
        message: `${spacingHours}h must pass between touches; ${elapsedHours.toFixed(1)}h have`,
      };
    }
  }

  return { ok: true, touchId: pending.touchId, step: pending.step, channel: pending.channel };
}

/**
 * The sequence state implied by its touches.
 *
 * Derived rather than stored independently, so the summary can never disagree
 * with the touches it summarises.
 */
export function sequenceStateFrom(touches: readonly TouchRecord[]): SequenceState {
  if (touches.some((t) => stopsSequence(t.state))) return 'stopped';
  if (touches.length > 0 && touches.every((t) => isTerminal(t.state))) return 'completed';
  if (touches.some((t) => t.state !== 'draft')) return 'active';
  return 'planned';
}
