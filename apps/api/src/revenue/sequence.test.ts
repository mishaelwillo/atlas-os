/**
 * Outreach sequence state (docs/specs/p2/revenue-pilot.md).
 *
 * The governing constraint is that a sequence "plans state but cannot bypass
 * per-touch checks". Most of what follows tests that the sequence cannot walk
 * itself into an outbound message.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_SEQUENCE_STEPS,
  MIN_TOUCH_SPACING_HOURS,
  OUTREACH_CHANNELS,
  TERMINAL_TOUCH_STATES,
  isTerminal,
  nextEligibleTouch,
  planSequence,
  planTouchAdvance,
  sequenceStateFrom,
  stopsSequence,
  type TouchRecord,
  type TouchState,
} from './sequence.js';

const NOW = new Date('2026-08-10T12:00:00.000Z');

function touch(overrides: Partial<TouchRecord> & { step: number }): TouchRecord {
  return {
    touchId: `touch-${overrides.step}`,
    channel: 'email',
    state: 'draft',
    sentAt: null,
    ...overrides,
  };
}

describe('planning a sequence', () => {
  it('numbers the steps in the order given', () => {
    const plan = planSequence({ channels: ['email', 'sms'], openSequence: false });
    expect(plan).toMatchObject({
      ok: true,
      steps: [
        { step: 1, channel: 'email' },
        { step: 2, channel: 'sms' },
      ],
    });
  });

  it('refuses an empty plan', () => {
    expect(planSequence({ channels: [], openSequence: false })).toMatchObject({
      ok: false,
      code: 'no_steps',
    });
  });

  /** More than the presenter's four touches is aggressive frequency. */
  it('refuses more touches than the pilot permits', () => {
    const channels = [...OUTREACH_CHANNELS].slice(0, MAX_SEQUENCE_STEPS + 1);
    expect(planSequence({ channels, openSequence: false })).toMatchObject({
      ok: false,
      code: 'too_many_steps',
    });
  });

  it('refuses a channel it does not know', () => {
    const refusal = planSequence({ channels: ['email', 'carrier_pigeon'], openSequence: false });
    expect(refusal).toMatchObject({ ok: false, code: 'unknown_channel' });
    if (refusal.ok) throw new Error('expected refusal');
    expect(refusal.message).toContain('carrier_pigeon');
  });

  /** Repeating a channel is the same message sent twice, not a cadence. */
  it('refuses a repeated channel', () => {
    expect(planSequence({ channels: ['email', 'email'], openSequence: false })).toMatchObject({
      ok: false,
      code: 'repeated_channel',
    });
  });

  it('refuses a second sequence while one is still open', () => {
    expect(planSequence({ channels: ['email'], openSequence: true })).toMatchObject({
      ok: false,
      code: 'sequence_already_open',
    });
  });
});

describe('moving a touch', () => {
  const base = { sequenceState: 'active', approvalId: null as string | null };

  it('walks the states the specification lists', () => {
    expect(planTouchAdvance({ ...base, from: 'draft', to: 'policy_check' })).toMatchObject({ ok: true });
    expect(planTouchAdvance({ ...base, from: 'policy_check', to: 'approval_required' })).toMatchObject({
      ok: true,
    });
    expect(
      planTouchAdvance({ ...base, from: 'approval_required', to: 'approved', approvalId: 'appr-1' }),
    ).toMatchObject({ ok: true });
    expect(planTouchAdvance({ ...base, from: 'approved', to: 'scheduled' })).toMatchObject({ ok: true });
    expect(
      planTouchAdvance({ ...base, from: 'scheduled', to: 'sent', viaDispatcher: true }),
    ).toMatchObject({ ok: true });
    expect(planTouchAdvance({ ...base, from: 'sent', to: 'delivered' })).toMatchObject({ ok: true });
  });

  /**
   * The heart of it: a sequence cannot record a send. Only the approval-gated
   * dispatcher may, because only it actually sends anything.
   */
  it('refuses to mark a touch sent from the sequence itself', () => {
    const refusal = planTouchAdvance({ ...base, from: 'scheduled', to: 'sent' });
    expect(refusal).toMatchObject({ ok: false, code: 'send_not_self_serviceable' });
  });

  it('refuses to approve a touch without a recorded approval', () => {
    expect(planTouchAdvance({ ...base, from: 'approval_required', to: 'approved' })).toMatchObject({
      ok: false,
      code: 'approval_required',
    });
  });

  it('refuses to skip the approval state entirely', () => {
    expect(
      planTouchAdvance({ ...base, from: 'policy_check', to: 'scheduled', approvalId: 'appr-1' }),
    ).toMatchObject({ ok: false, code: 'not_a_permitted_transition' });
  });

  it('refuses to skip straight from draft to sent', () => {
    expect(
      planTouchAdvance({ ...base, from: 'draft', to: 'sent', viaDispatcher: true }),
    ).toMatchObject({ ok: false, code: 'not_a_permitted_transition' });
  });

  it('refuses to rewind', () => {
    expect(planTouchAdvance({ ...base, from: 'approved', to: 'draft' })).toMatchObject({
      ok: false,
      code: 'not_a_permitted_transition',
    });
  });

  it('refuses to move a finished touch', () => {
    for (const from of TERMINAL_TOUCH_STATES) {
      expect(planTouchAdvance({ ...base, from, to: 'delivered' })).toMatchObject({
        ok: false,
        code: 'touch_terminal',
      });
    }
  });

  it('refuses any move once the sequence has stopped', () => {
    expect(
      planTouchAdvance({ ...base, sequenceState: 'stopped', from: 'draft', to: 'policy_check' }),
    ).toMatchObject({ ok: false, code: 'sequence_stopped' });
  });

  it('refuses a state it does not know', () => {
    expect(planTouchAdvance({ ...base, from: 'draft', to: 'opened' })).toMatchObject({
      ok: false,
      code: 'unknown_state',
    });
  });

  /** A reply or an opt-out ends the plan; a non-reply does not. */
  it('reports which outcomes stop the sequence', () => {
    expect(planTouchAdvance({ ...base, from: 'delivered', to: 'replied' })).toMatchObject({
      ok: true,
      stopsSequence: true,
    });
    expect(planTouchAdvance({ ...base, from: 'delivered', to: 'suppressed' })).toMatchObject({
      ok: true,
      stopsSequence: true,
    });
    expect(planTouchAdvance({ ...base, from: 'delivered', to: 'no_reply' })).toMatchObject({
      ok: true,
      stopsSequence: false,
    });
  });

  it('treats a failed send as finished but not as a stop', () => {
    expect(planTouchAdvance({ ...base, from: 'sent', to: 'failed' })).toMatchObject({
      ok: true,
      stopsSequence: false,
    });
    expect(isTerminal('failed')).toBe(true);
    expect(stopsSequence('failed')).toBe(false);
  });
});

describe('choosing the next touch', () => {
  it('offers the first planned touch', () => {
    const next = nextEligibleTouch({
      sequenceState: 'planned',
      touches: [touch({ step: 1 }), touch({ step: 2, channel: 'sms' })],
      now: NOW,
    });
    expect(next).toMatchObject({ ok: true, step: 1, channel: 'email' });
  });

  /**
   * Only one touch may be open. Otherwise a reply to the first arrives after
   * the second has already gone out, and per-touch eligibility means nothing.
   */
  it('refuses while a touch is still in flight', () => {
    const refusal = nextEligibleTouch({
      sequenceState: 'active',
      touches: [touch({ step: 1, state: 'delivered' }), touch({ step: 2 })],
      now: NOW,
    });
    expect(refusal).toMatchObject({ ok: false, code: 'touch_in_flight' });
  });

  it('refuses until the spacing has elapsed', () => {
    const refusal = nextEligibleTouch({
      sequenceState: 'active',
      touches: [
        touch({ step: 1, state: 'no_reply', sentAt: '2026-08-10T00:00:00.000Z' }),
        touch({ step: 2, channel: 'sms' }),
      ],
      now: NOW,
    });
    expect(refusal).toMatchObject({ ok: false, code: 'spacing_not_elapsed' });
    if (refusal.ok) throw new Error('expected refusal');
    expect(refusal.message).toContain(String(MIN_TOUCH_SPACING_HOURS));
  });

  it('offers the next touch once the spacing has elapsed', () => {
    const sentAt = new Date(NOW.getTime() - (MIN_TOUCH_SPACING_HOURS + 1) * 3_600_000).toISOString();
    const next = nextEligibleTouch({
      sequenceState: 'active',
      touches: [
        touch({ step: 1, state: 'no_reply', sentAt }),
        touch({ step: 2, channel: 'sms' }),
      ],
      now: NOW,
    });
    expect(next).toMatchObject({ ok: true, step: 2, channel: 'sms' });
  });

  it('refuses once every planned touch is resolved', () => {
    expect(
      nextEligibleTouch({
        sequenceState: 'active',
        touches: [touch({ step: 1, state: 'no_reply', sentAt: '2026-01-01T00:00:00.000Z' })],
        now: NOW,
      }),
    ).toMatchObject({ ok: false, code: 'sequence_exhausted' });
  });

  it('refuses when the sequence has stopped', () => {
    expect(
      nextEligibleTouch({ sequenceState: 'stopped', touches: [touch({ step: 1 })], now: NOW }),
    ).toMatchObject({ ok: false, code: 'sequence_stopped' });
  });
});

/** Derived, so the summary can never disagree with the touches it summarises. */
describe('sequenceStateFrom', () => {
  const cases: Array<[string, TouchState[], string]> = [
    ['nothing started', ['draft', 'draft'], 'planned'],
    ['something in flight', ['policy_check', 'draft'], 'active'],
    ['a reply', ['replied', 'draft'], 'stopped'],
    ['an opt-out', ['suppressed', 'draft'], 'stopped'],
    ['everything resolved', ['no_reply', 'failed'], 'completed'],
  ];

  for (const [name, states, expected] of cases) {
    it(`reads ${name} as ${expected}`, () => {
      const touches = states.map((state, i) => touch({ step: i + 1, state }));
      expect(sequenceStateFrom(touches)).toBe(expected);
    });
  }

  /** A stop outranks completion: a replied sequence is stopped, not finished. */
  it('reports a replied sequence as stopped even when nothing is left', () => {
    expect(sequenceStateFrom([touch({ step: 1, state: 'replied' })])).toBe('stopped');
  });
});
