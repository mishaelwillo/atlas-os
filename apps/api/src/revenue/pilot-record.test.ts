/**
 * The pilot's cost, support and outcome record
 * (docs/specs/p2/revenue-pilot.md).
 *
 * Exit criterion: "One paying customer and complete cost/support/outcome
 * record satisfy pilot exit." The second half had no implementation — six
 * metrics were named as unavailable so the gap could not be mistaken for a
 * measurement, and these are the rules that close them.
 *
 * What is under test is mostly what the module refuses to invent: an hourly
 * rate, a default satisfaction, a margin from partial costs, a duration for a
 * stage nobody reached.
 */
import { describe, expect, it } from 'vitest';
import {
  COST_CATEGORIES,
  TIMED_STAGES,
  assessRecord,
  daysToActivation,
  grossMargin,
  planCostEntry,
  planOutcome,
  stageDurations,
  type StageTimestamps,
} from './pilot-record.js';

const MONEY = { category: 'provider', amountMinor: 1200, currency: 'usd', minutes: null, note: 'Pages plan' };
const TIME = { category: 'labour', amountMinor: null, currency: null, minutes: 90, note: 'built the demo' };

describe('recording a cost entry', () => {
  it('records money with its currency, normalised', () => {
    expect(planCostEntry(MONEY)).toMatchObject({
      ok: true,
      amountMinor: 1200,
      currency: 'USD',
      minutes: null,
    });
  });

  it('records time with no money', () => {
    expect(planCostEntry(TIME)).toMatchObject({ ok: true, minutes: 90, amountMinor: null, currency: null });
  });

  /**
   * The central refusal. Nothing converts minutes to money in Atlas, so an
   * entry carrying both cannot be summed either way — and inventing an hourly
   * rate to reconcile them would produce a margin that looks authoritative and
   * is made up.
   */
  it('refuses an entry that is both money and time', () => {
    expect(
      planCostEntry({ ...MONEY, minutes: 30 }),
    ).toMatchObject({ ok: false, code: 'money_and_time' });
  });

  it('refuses an entry that is neither', () => {
    expect(
      planCostEntry({ category: 'demo', amountMinor: null, currency: null, minutes: null, note: 'x' }),
    ).toMatchObject({ ok: false, code: 'neither_money_nor_time' });
  });

  /** Mixed currencies are never summed, so the currency travels with the figure. */
  it('refuses an amount with no currency', () => {
    expect(planCostEntry({ ...MONEY, currency: null })).toMatchObject({
      ok: false,
      code: 'currency_missing',
    });
  });

  /** Zero is a real observation: a provider that charged nothing this month. */
  it('accepts zero for money and for time', () => {
    expect(planCostEntry({ ...MONEY, amountMinor: 0 })).toMatchObject({ ok: true, amountMinor: 0 });
    expect(planCostEntry({ ...TIME, minutes: 0 })).toMatchObject({ ok: true, minutes: 0 });
  });

  it('refuses a negative cost', () => {
    expect(planCostEntry({ ...MONEY, amountMinor: -1 })).toMatchObject({
      ok: false,
      code: 'negative_amount',
    });
  });

  /** A figure nobody described cannot be audited later. */
  it('refuses an entry with no note', () => {
    expect(planCostEntry({ ...MONEY, note: '   ' })).toMatchObject({ ok: false, code: 'note_missing' });
  });

  it('refuses a category outside the vocabulary', () => {
    expect(planCostEntry({ ...MONEY, category: 'marketing' })).toMatchObject({
      ok: false,
      code: 'unknown_category',
    });
  });
});

describe('recording satisfaction', () => {
  it('records a score with its reason', () => {
    expect(planOutcome({ satisfaction: 4, note: 'said the site reads well' })).toMatchObject({
      ok: true,
      satisfaction: 4,
    });
  });

  /**
   * No default. Filling an unrecorded satisfaction with a middle value turns
   * "nobody asked" into "they were indifferent", which is a different and
   * unearned claim.
   */
  it.each([0, 6, 2.5, Number.NaN])('refuses %s as a score', (satisfaction) => {
    expect(planOutcome({ satisfaction, note: 'x' })).toMatchObject({
      ok: false,
      code: 'satisfaction_out_of_range',
    });
  });

  it('refuses a score with no reason', () => {
    expect(planOutcome({ satisfaction: 5, note: null })).toMatchObject({ ok: false, code: 'note_missing' });
  });
});

describe('whether the record is complete', () => {
  /** Derived, never declared — a tick box is a claim nothing checks. */
  it('is complete only with every category and a satisfaction score', () => {
    expect(
      assessRecord({ categoriesRecorded: [...COST_CATEGORIES], hasSatisfaction: true }),
    ).toMatchObject({ complete: true, missingCategories: [], satisfactionMissing: false });
  });

  it('names the categories that are missing rather than only saying no', () => {
    const result = assessRecord({ categoriesRecorded: ['provider', 'demo'], hasSatisfaction: true });
    expect(result.complete).toBe(false);
    expect(result.missingCategories).toEqual(['labour', 'support']);
  });

  it('is incomplete with every cost but no satisfaction', () => {
    expect(
      assessRecord({ categoriesRecorded: [...COST_CATEGORIES], hasSatisfaction: false }),
    ).toMatchObject({ complete: false, satisfactionMissing: true });
  });
});

describe('stage durations', () => {
  const full: StageTimestamps = {
    sourced: '2026-08-01T00:00:00.000Z',
    assessed: '2026-08-01T06:00:00.000Z',
    demoQueued: '2026-08-01T12:00:00.000Z',
    demoShareable: '2026-08-02T00:00:00.000Z',
    firstTouch: '2026-08-03T00:00:00.000Z',
    offerPublished: '2026-08-05T00:00:00.000Z',
    dealAccepted: '2026-08-06T00:00:00.000Z',
    hostingActivated: '2026-08-07T00:00:00.000Z',
  };

  it('derives every stage from timestamps the pilot already writes', () => {
    const durations = stageDurations(full);
    expect(Object.keys(durations)).toEqual([...TIMED_STAGES]);
    expect(durations.sourced_to_assessed).toBe(6);
    expect(durations.accepted_to_activated).toBe(24);
    expect(daysToActivation(full)).toBe(6);
  });

  /**
   * Not reached is not zero. Zero would say the stage took no time; the funnel
   * renders null as an em dash for the same reason a rate with no denominator
   * is not reported as 0%.
   */
  it('reports a stage nobody reached as unknown, not zero', () => {
    const durations = stageDurations({ ...full, hostingActivated: null });
    expect(durations.accepted_to_activated).toBeNull();
    expect(daysToActivation({ ...full, hostingActivated: null })).toBeNull();
  });

  /** Out-of-order timestamps are a finding, not a negative duration. */
  it('reports a backwards gap as unknown', () => {
    const durations = stageDurations({ ...full, assessed: '2026-07-01T00:00:00.000Z' });
    expect(durations.sourced_to_assessed).toBeNull();
  });

  it('reports an unparseable timestamp as unknown', () => {
    expect(stageDurations({ ...full, assessed: 'not a date' }).sourced_to_assessed).toBeNull();
  });
});

describe('gross margin', () => {
  /**
   * The refusal that matters. A margin from part of the costs is always too
   * high, and the missing number is exactly the one nobody got round to
   * recording.
   */
  it('refuses to compute a margin from an incomplete cost record', () => {
    const report = grossMargin({
      recurringMinorByCurrency: { USD: 10_000 },
      costMinorByCurrency: { USD: 1_000 },
      costRecordComplete: false,
    });
    expect(report.grossMarginMinorByCurrency).toBeNull();
    expect(report.unavailableReason).toMatch(/incomplete/);
  });

  it('computes per currency once the record is complete', () => {
    const report = grossMargin({
      recurringMinorByCurrency: { USD: 10_000, JMD: 500 },
      costMinorByCurrency: { USD: 1_500 },
      costRecordComplete: true,
    });
    expect(report.grossMarginMinorByCurrency).toEqual({ USD: 8_500, JMD: 500 });
    expect(report.unavailableReason).toBeNull();
  });

  /** Currencies are never summed, even when one side has no entry. */
  it('keeps currencies apart rather than folding them together', () => {
    const report = grossMargin({
      recurringMinorByCurrency: { JMD: 900 },
      costMinorByCurrency: { USD: 400 },
      costRecordComplete: true,
    });
    expect(report.grossMarginMinorByCurrency).toEqual({ JMD: 900, USD: -400 });
  });
});
