/**
 * Reporting what an approval actually caused.
 *
 * The approvals card previously discarded the API's `dispatched` result, so a
 * successful dispatch, a failed one, and a missing dispatcher were
 * indistinguishable: all three simply removed the row from the pending queue.
 * On the one screen where external effects are authorised, that is the wrong
 * default.
 */
import { describe, expect, it } from 'vitest';
import { describeDispatch } from './MissionControl.js';

describe('describeDispatch', () => {
  it('states plainly that a rejection executed nothing', () => {
    expect(describeDispatch('rejected', { executed: true })).toBe(
      'Rejected — nothing was executed.',
    );
  });

  it('reports a real dispatch', () => {
    expect(describeDispatch('approved', { executed: true })).toContain('Approved and dispatched');
  });

  /** The operator must not read a stub as a real send. */
  it('marks a stub dispatch as such', () => {
    const text = describeDispatch('approved', {
      executed: true,
      stub: true,
      note: 'log-only sender — no message left the system',
    });
    expect(text).toContain('log-only stub');
    expect(text).toContain('no message left the system');
  });

  /**
   * Approving something with no dispatcher registered is the most dangerous
   * case, because the operator believes an action was taken.
   */
  it('says so when nothing executed', () => {
    const text = describeDispatch('approved', {
      executed: false,
      note: "no dispatcher for kind 'x'",
    });
    expect(text).toContain('nothing executed');
    expect(text).toContain('no dispatcher');
  });

  it('does not claim success when the server reported no result', () => {
    const text = describeDispatch('approved', null);
    expect(text).toContain('no dispatch result');
    expect(text).not.toMatch(/dispatched \(/);
  });

  it('still reads sensibly when the dispatcher returned no note', () => {
    expect(describeDispatch('approved', { executed: true, stub: true })).toBe(
      'Approved and dispatched (log-only stub).',
    );
  });
});
