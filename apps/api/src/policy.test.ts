import { describe, expect, it } from 'vitest';
import { BLOCKED_LEAD_STATUSES, checkOutreachPolicy, parseDailyCap } from './policy.js';

const base = { leadStatus: 'new' as string | null, touchesToday: 0, dailyCap: 10 };

describe('outreach suppression', () => {
  it('permits a touch to an engageable lead', () => {
    expect(checkOutreachPolicy(base)).toBeNull();
  });

  it.each([...BLOCKED_LEAD_STATUSES])('refuses a lead that is %s', (status) => {
    const refusal = checkOutreachPolicy({ ...base, leadStatus: status });
    expect(refusal?.code).toBe('lead_suppressed');
    expect(refusal?.message).toContain(status);
  });

  /** Stopping on reply is the spec's rule, not an optional courtesy. */
  it('stops a sequence once the lead has replied', () => {
    expect(checkOutreachPolicy({ ...base, leadStatus: 'replied' })?.code).toBe('lead_suppressed');
  });

  it.each(['new', 'demo-built', 'contacted'])('still permits a lead that is %s', (status) => {
    expect(checkOutreachPolicy({ ...base, leadStatus: status })).toBeNull();
  });

  /**
   * Lead sourcing has no adapter yet, so operators reference prospects found by
   * hand. Refusing unknown references would block the only workflow that exists.
   */
  it('permits an unknown lead reference', () => {
    expect(checkOutreachPolicy({ ...base, leadStatus: null })).toBeNull();
  });

  it('still caps an unknown lead reference', () => {
    expect(checkOutreachPolicy({ leadStatus: null, touchesToday: 10, dailyCap: 10 })?.code).toBe(
      'daily_cap_reached',
    );
  });
});

describe('daily cap', () => {
  it('permits a touch below the cap', () => {
    expect(checkOutreachPolicy({ ...base, touchesToday: 9, dailyCap: 10 })).toBeNull();
  });

  it('refuses at the cap, not one past it', () => {
    const refusal = checkOutreachPolicy({ ...base, touchesToday: 10, dailyCap: 10 });
    expect(refusal?.code).toBe('daily_cap_reached');
    expect(refusal?.message).toContain('10');
  });

  it('refuses beyond the cap', () => {
    expect(checkOutreachPolicy({ ...base, touchesToday: 99, dailyCap: 10 })?.code).toBe(
      'daily_cap_reached',
    );
  });

  /** Suppression is the stronger signal and must be reported first. */
  it('reports suppression rather than the cap when both apply', () => {
    expect(
      checkOutreachPolicy({ leadStatus: 'suppressed', touchesToday: 99, dailyCap: 10 })?.code,
    ).toBe('lead_suppressed');
  });

  it('treats a non-positive cap as no limit', () => {
    expect(checkOutreachPolicy({ ...base, touchesToday: 500, dailyCap: 0 })).toBeNull();
    expect(checkOutreachPolicy({ ...base, touchesToday: 500, dailyCap: -1 })).toBeNull();
  });
});

describe('cap configuration', () => {
  it('defaults when unset or blank', () => {
    expect(parseDailyCap(undefined)).toBe(10);
    expect(parseDailyCap('   ')).toBe(10);
  });

  it('reads a configured integer', () => {
    expect(parseDailyCap('25')).toBe(25);
  });

  /** A typo must not silently become an unlimited or zero cap. */
  it.each(['abc', '1.5', 'NaN', 'Infinity'])('falls back for the unusable value %s', (raw) => {
    expect(parseDailyCap(raw)).toBe(10);
  });

  it('accepts an explicit zero as disabling the limit', () => {
    expect(parseDailyCap('0')).toBe(0);
  });
});
