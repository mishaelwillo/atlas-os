/**
 * Reachability across every revenue state machine
 * (docs/specs/p2/revenue-pilot.md, "Workflow and states").
 *
 * The hosting chain shipped with three of seven states unreachable while the
 * transition table, ENTITLED_STATES, planCancellation and the funnel's revenue
 * SQL all spoke as though they were not. Nothing failed because nothing asked.
 * These ask, of all four machines.
 */
import { describe, expect, it } from 'vitest';
import {
  declaredButReachable,
  reachableStates,
  unreachableUndeclared,
} from './reachability.js';
import {
  REVENUE_STATE_MACHINES,
  dealMachine,
  demoMachine,
  hostingMachine,
  touchMachine,
} from './state-machines.js';
import { SEQUENCE_STATES, sequenceStateFrom, type TouchRecord } from './sequence.js';

describe('every revenue state machine', () => {
  for (const machine of REVENUE_STATE_MACHINES) {
    describe(machine.name, () => {
      /** The finding the hosting gap was. */
      it('leaves no state both unreachable and undeclared', () => {
        expect(unreachableUndeclared(machine)).toEqual([]);
      });

      /**
       * The opposite error, and the one that gets worse with time: a deferral
       * left in place after the thing it waited for shipped reads as a
       * limitation the system no longer has.
       */
      it('declares nothing deferred that it can actually reach', () => {
        expect(declaredButReachable(machine)).toEqual([]);
      });

      it('gives every deferred state a reason', () => {
        for (const [state, reason] of Object.entries(machine.deferred)) {
          expect(machine.states as readonly string[]).toContain(state);
          expect(String(reason).length, `${machine.name}/${state}`).toBeGreaterThan(40);
        }
      });

      /** An entrance nothing can enter would make the whole walk vacuous. */
      it('has at least one entrance, and every entrance is a real state', () => {
        expect(machine.entry.length).toBeGreaterThan(0);
        for (const state of machine.entry) {
          expect(machine.states as readonly string[]).toContain(state);
        }
      });
    });
  }
});

/**
 * Per-machine expectations, spelled out so a change in what is reachable has
 * to be a deliberate edit rather than a quietly passing generic assertion.
 */
describe('what each machine can reach', () => {
  it('hosting reaches every state but past_due', () => {
    const reachable = reachableStates(hostingMachine);
    expect([...reachable].sort()).toEqual(
      ['active', 'cancelled', 'entitlement_active', 'onboarded', 'payment_pending', 'terms_approved'].sort(),
    );
    expect(reachable.has('past_due')).toBe(false);
  });

  it('the demo queue reaches all six of its states', () => {
    expect(reachableStates(demoMachine).size).toBe(demoMachine.states.length);
  });

  /** Including `sent`, which only the approved dispatcher can produce. */
  it('a touch reaches every state, sent included', () => {
    const reachable = reachableStates(touchMachine);
    expect(reachable.size).toBe(touchMachine.states.length);
    expect(reachable.has('sent')).toBe(true);
  });

  /**
   * `sent` is reachable only through the dispatcher. Withdraw that and it must
   * disappear — if it survived, some other caller could record a send that no
   * dispatch performed, which is the audit-trail lie the flag exists to stop.
   */
  it('a touch cannot reach sent without the dispatcher', () => {
    const withoutDispatcher = {
      ...touchMachine,
      canRequest: (from: string, to: string) =>
        touchMachine.canRequest(from, to) && !(from === 'scheduled' && to === 'sent'),
    };
    expect(reachableStates(withoutDispatcher).has('sent')).toBe(false);
  });

  /**
   * Including `interested`, which nothing could record until a first decision
   * stopped being counted from it.
   */
  it('a deal reaches all five of its states', () => {
    const reachable = reachableStates(dealMachine);
    expect(reachable.size).toBe(dealMachine.states.length);
    expect(reachable.has('interested')).toBe(true);
  });
});

/**
 * Sequence state is derived from its touches rather than transitioned into, so
 * the question is whether some real arrangement of touches produces each one —
 * a declared state no arrangement yields would be the same defect in a
 * different shape.
 */
describe('sequence state', () => {
  const touch = (state: string): TouchRecord =>
    ({ state, step: 1, channel: 'email' }) as unknown as TouchRecord;

  it('every declared sequence state is produced by some arrangement of touches', () => {
    const produced = new Set([
      sequenceStateFrom([touch('draft')]),
      sequenceStateFrom([touch('policy_check')]),
      sequenceStateFrom([touch('replied')]),
      sequenceStateFrom([touch('no_reply')]),
    ]);
    expect([...produced].sort()).toEqual([...SEQUENCE_STATES].sort());
  });
});
