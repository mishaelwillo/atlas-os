/**
 * Demo queue (docs/specs/p2/revenue-pilot.md).
 * Acceptance: "Demo queue enforces 5–10 cap and QA/approval/expiry."
 */
import { describe, expect, it } from 'vitest';
import {
  ACTIVE_DEMO_STATES,
  DEMO_QUEUE_CAP,
  DEMO_QUEUE_FLOOR,
  DEMO_TTL_DAYS,
  demoExpiry,
  planAdvance,
  planEnqueue,
  type QueuedDemo,
} from './demo-queue.js';

function active(n: number): QueuedDemo[] {
  return Array.from({ length: n }, (_, i) => ({
    queueId: `q-${i}`,
    leadId: `lead-${i}`,
    state: 'queued' as const,
  }));
}

const base = {
  leadId: 'lead-new',
  verdict: 'qualified',
  assessmentExpired: false,
  active: [] as QueuedDemo[],
};

describe('taking a demo slot', () => {
  it('admits a qualified prospect and reports the slots left', () => {
    const plan = planEnqueue({ ...base, active: active(3) });
    expect(plan).toMatchObject({ ok: true, remaining: DEMO_QUEUE_CAP - 4 });
  });

  /**
   * The demo is the first thing a prospect sees of Atlas. Building one for
   * someone nobody qualified is how a page gets made from unchecked facts.
   */
  it('refuses a prospect with no assessment', () => {
    const refusal = planEnqueue({ ...base, verdict: null });
    expect(refusal).toMatchObject({ ok: false, code: 'not_qualified' });
    if (refusal.ok) throw new Error('expected refusal');
    expect(refusal.message).toMatch(/no qualification assessment/);
  });

  it('refuses a prospect still in eligibility review', () => {
    const refusal = planEnqueue({ ...base, verdict: 'eligibility_review' });
    expect(refusal).toMatchObject({ ok: false, code: 'not_qualified' });
  });

  it('refuses a disqualified prospect', () => {
    expect(planEnqueue({ ...base, verdict: 'disqualified' })).toMatchObject({
      ok: false,
      code: 'not_qualified',
    });
  });

  it('refuses when the assessment has gone stale', () => {
    expect(planEnqueue({ ...base, assessmentExpired: true })).toMatchObject({
      ok: false,
      code: 'assessment_expired',
    });
  });

  it('refuses a prospect that already holds a slot', () => {
    const refusal = planEnqueue({
      ...base,
      active: [{ queueId: 'q-1', leadId: 'lead-new', state: 'building' }],
    });
    expect(refusal).toMatchObject({ ok: false, code: 'already_queued' });
  });

  /** The cap is the pilot's restraint; every slot is a page a human stands behind. */
  it('refuses at the cap', () => {
    const refusal = planEnqueue({ ...base, active: active(DEMO_QUEUE_CAP) });
    expect(refusal).toMatchObject({ ok: false, code: 'cap_reached' });
    if (refusal.ok) throw new Error('expected refusal');
    expect(refusal.message).toContain(String(DEMO_QUEUE_CAP));
  });

  it('admits the last slot below the cap', () => {
    expect(planEnqueue({ ...base, active: active(DEMO_QUEUE_CAP - 1) })).toMatchObject({
      ok: true,
      remaining: 0,
    });
  });

  /** A thin queue is reported, not refused. */
  it('flags a queue still under the pilot floor without blocking it', () => {
    const plan = planEnqueue({ ...base, active: active(1) });
    expect(plan).toMatchObject({ ok: true, belowFloor: true });
  });

  it('stops flagging once the floor is reached', () => {
    expect(planEnqueue({ ...base, active: active(DEMO_QUEUE_FLOOR - 1) })).toMatchObject({
      ok: true,
      belowFloor: false,
    });
  });

  it('counts every state that occupies a slot', () => {
    const occupying = ACTIVE_DEMO_STATES.map((state, i) => ({
      queueId: `q-${i}`,
      leadId: `lead-${i}`,
      state,
    }));
    const plan = planEnqueue({ ...base, active: occupying });
    expect(plan).toMatchObject({ ok: true, remaining: DEMO_QUEUE_CAP - occupying.length - 1 });
    expect(ACTIVE_DEMO_STATES).not.toContain('expired');
  });
});

describe('moving a demo along', () => {
  it('allows each declared step', () => {
    expect(planAdvance('queued', 'building')).toMatchObject({ ok: true });
    expect(planAdvance('building', 'qa')).toMatchObject({ ok: true });
    expect(planAdvance('qa', 'approved')).toMatchObject({ ok: true });
    expect(planAdvance('approved', 'shareable')).toMatchObject({ ok: true });
  });

  /** Jumping the queue would put a page in front of an owner without QA. */
  it('refuses a jump past QA', () => {
    const refusal = planAdvance('queued', 'approved');
    expect(refusal).toMatchObject({ ok: false, code: 'not_the_next_state' });
    if (refusal.ok) throw new Error('expected refusal');
    expect(refusal.message).toContain('building');
  });

  it('refuses to rewind', () => {
    expect(planAdvance('qa', 'building')).toMatchObject({ ok: false, code: 'not_the_next_state' });
  });

  it('allows expiry from anything still in flight', () => {
    for (const from of ['queued', 'building', 'qa', 'approved'] as const) {
      expect(planAdvance(from, 'expired')).toMatchObject({ ok: true, to: 'expired' });
    }
  });

  it('refuses to move a shareable or expired demo again', () => {
    expect(planAdvance('shareable', 'expired')).toMatchObject({ ok: false, code: 'terminal_state' });
    expect(planAdvance('expired', 'queued')).toMatchObject({ ok: false, code: 'terminal_state' });
  });

  it('refuses a state it does not know', () => {
    expect(planAdvance('queued', 'published')).toMatchObject({ ok: false, code: 'unknown_state' });
    expect(planAdvance('sourced', 'building')).toMatchObject({ ok: false, code: 'unknown_state' });
  });
});

describe('demoExpiry', () => {
  it('is the queue time plus the demo lifetime', () => {
    const at = new Date('2026-08-03T00:00:00.000Z');
    expect(demoExpiry(at).toISOString()).toBe(
      new Date(at.getTime() + DEMO_TTL_DAYS * 86400000).toISOString(),
    );
  });
});
