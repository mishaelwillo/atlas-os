/**
 * Funnel analytics (docs/specs/p2/revenue-pilot.md).
 *
 * The pilot records "zero customers as evidence, not concealed", so most of
 * what follows tests that an empty funnel reads as empty rather than as failure,
 * and that nothing unmeasured is reported as zero.
 */
import { describe, expect, it } from 'vitest';
import {
  UNAVAILABLE_METRICS,
  buildFunnel,
  channelContribution,
  percent,
  rate,
  type StageCounts,
} from './funnel.js';

function counts(overrides: Partial<StageCounts> = {}): StageCounts {
  return {
    sourced: 0,
    assessed: 0,
    qualified: 0,
    inReview: 0,
    disqualified: 0,
    demosQueued: 0,
    demosShareable: 0,
    sequencesPlanned: 0,
    touchesSent: 0,
    touchesDelivered: 0,
    replied: 0,
    suppressed: 0,
    offersPublished: 0,
    dealsInterested: 0,
    dealsAccepted: 0,
    dealsDeclined: 0,
    entitlementsActive: 0,
    entitlementsCancelled: 0,
    ...overrides,
  };
}

describe('rate', () => {
  /**
   * The distinction the whole module rests on. "0% reply rate" on a pilot that
   * has sent nothing invites someone to fix the messaging.
   */
  it('is null when nothing entered the stage, not zero', () => {
    expect(rate(0, 0)).toBeNull();
    expect(percent(0, 0)).toBeNull();
  });

  it('is zero when something entered and none converted', () => {
    expect(rate(0, 10)).toBe(0);
    expect(percent(0, 10)).toBe(0);
  });

  it('rounds a percentage to one decimal', () => {
    expect(percent(1, 3)).toBe(33.3);
    expect(percent(2, 3)).toBe(66.7);
  });

  it('refuses a negative or non-finite denominator', () => {
    expect(rate(1, -5)).toBeNull();
    expect(rate(1, Number.NaN)).toBeNull();
    expect(rate(Number.POSITIVE_INFINITY, 5)).toBeNull();
  });
});

describe('an empty funnel', () => {
  const report = buildFunnel({ counts: counts() });

  it('says it is empty rather than reporting failure', () => {
    expect(report.empty).toBe(true);
    expect(report.stages.every((s) => s.count === 0)).toBe(true);
  });

  /** Every conversion is unknown, and none of them is 0%. */
  it('reports no conversion as unknown', () => {
    for (const stage of report.stages.slice(1)) {
      expect(stage.conversionPercent).toBeNull();
    }
    for (const value of Object.values(report.rates)) {
      expect(value).toBeNull();
    }
  });

  it('claims no revenue and no customers', () => {
    expect(report.revenue.payingCustomers).toBe(0);
    expect(report.revenue.recurringMinorByCurrency).toEqual({});
  });
});

describe('a funnel with real movement', () => {
  const report = buildFunnel({
    counts: counts({
      sourced: 40,
      assessed: 30,
      qualified: 12,
      inReview: 10,
      disqualified: 8,
      demosQueued: 8,
      demosShareable: 6,
      touchesSent: 6,
      touchesDelivered: 5,
      replied: 2,
      suppressed: 1,
      offersPublished: 2,
      dealsAccepted: 1,
      dealsDeclined: 1,
      entitlementsActive: 1,
      entitlementsCancelled: 1,
    }),
    recurringMinorByCurrency: { USD: 4900 },
  });

  it('is not empty', () => {
    expect(report.empty).toBe(false);
  });

  /**
   * The exit criterion's second half. Before migration 0012 nothing recorded
   * costs, so the funnel named six metrics as unavailable rather than
   * defaulting them to zero.
   */
  describe('the cost, support and outcome record', () => {
    const complete = {
      minorByCurrency: { USD: 2_500 },
      minutesByCategory: { labour: 120, support: 30 },
      categoriesRecorded: ['provider', 'labour', 'support', 'demo'],
      satisfactionAverage: 4.5,
      satisfactionCount: 2,
    };

    /**
     * Absent is not empty. An empty rollup would present as a complete
     * zero-cost record and report a margin equal to revenue.
     */
    it('reports every metric unavailable when nothing has been recorded', () => {
      const none = buildFunnel({ counts: counts({ sourced: 1 }), recurringMinorByCurrency: {} });
      expect(none.costRecord.complete).toBe(false);
      expect(none.unavailable).toEqual([
        'provider_cost',
        'labour_cost',
        'support_time',
        'demo_cost',
        'satisfaction',
      ]);
      expect(none.grossMarginMinorByCurrency).toBeNull();
    });

    /** The list shrinks as the record fills, rather than staying fixed. */
    it('names only what is still missing once some categories are recorded', () => {
      const partial = buildFunnel({
        counts: counts({ sourced: 1 }),
        recurringMinorByCurrency: {},
        cost: { ...complete, categoriesRecorded: ['provider', 'demo'], satisfactionCount: 0, satisfactionAverage: null },
      });
      expect(partial.unavailable).toEqual(['labour_cost', 'support_time', 'satisfaction']);
      expect(partial.costRecord.missingCategories).toEqual(['labour', 'support']);
    });

    /** A margin from part of the costs is always too high. */
    it('withholds gross margin until the record is complete', () => {
      const partial = buildFunnel({
        counts: counts({ sourced: 1 }),
        recurringMinorByCurrency: { USD: 10_000 },
        cost: { ...complete, categoriesRecorded: ['provider'] },
      });
      expect(partial.grossMarginMinorByCurrency).toBeNull();
      expect(partial.grossMarginUnavailableReason).toMatch(/incomplete/);
    });

    it('reports margin and an empty gap list once complete', () => {
      const full = buildFunnel({
        counts: counts({ sourced: 1 }),
        recurringMinorByCurrency: { USD: 10_000 },
        cost: complete,
      });
      expect(full.costRecord.complete).toBe(true);
      expect(full.unavailable).toEqual([]);
      expect(full.grossMarginMinorByCurrency).toEqual({ USD: 7_500 });
      expect(full.costRecord.satisfaction).toBe(4.5);
    });

    /** Minutes are reported, never converted into the money total. */
    it('keeps recorded time out of the money figures', () => {
      const full = buildFunnel({
        counts: counts({ sourced: 1 }),
        recurringMinorByCurrency: { USD: 10_000 },
        cost: complete,
      });
      expect(full.costRecord.minutesByCategory).toEqual({ labour: 120, support: 30 });
      expect(full.costRecord.minorByCurrency).toEqual({ USD: 2_500 });
      expect(JSON.stringify(full.grossMarginMinorByCurrency)).not.toContain('150');
    });
  });

  /**
   * Recorded interest is a floor, not a gate. A first decision may skip
   * straight to discovery, so an offer can exist without one — measuring
   * offers against interest would read over 100% the first time an operator
   * skipped the step, and would imply a path every deal did not take.
   */
  it('does not measure offers against recorded interest', () => {
    const skipped = buildFunnel({
      counts: counts({ replied: 4, dealsInterested: 0, offersPublished: 2 }),
      recurringMinorByCurrency: {},
    });
    expect(skipped.stages.find((s) => s.id === 'interested')).toMatchObject({
      count: 0,
      of: 'replied',
    });
    expect(skipped.stages.find((s) => s.id === 'offer_published')).toMatchObject({
      of: 'replied',
      conversionPercent: 50,
    });
  });

  /** A rate with no denominator stays unknown here too. */
  it('reports interest as unknown when nothing replied', () => {
    const nothing = buildFunnel({
      counts: counts({ replied: 0, dealsInterested: 0 }),
      recurringMinorByCurrency: {},
    });
    expect(nothing.stages.find((s) => s.id === 'interested')).toMatchObject({
      conversionPercent: null,
    });
  });

  it('measures each stage against the one before it, and says which', () => {
    const qualified = report.stages.find((s) => s.id === 'qualified');
    expect(qualified).toMatchObject({ count: 12, of: 'assessed', conversionPercent: 40 });
    const active = report.stages.find((s) => s.id === 'hosting_active');
    expect(active).toMatchObject({ of: 'accepted', conversionPercent: 100 });
  });

  it('measures the reply rate against delivery, not against sends', () => {
    expect(report.rates.replyRate).toBe(40);
    expect(report.rates.deliveryRate).toBe(percent(5, 6));
  });

  /** Dividing by the survivors would make churn shrink as customers leave. */
  it('measures churn against everyone ever entitled', () => {
    expect(report.rates.churnRate).toBe(50);
  });

  it('reports revenue per currency without summing across them', () => {
    const mixed = buildFunnel({
      counts: counts({ entitlementsActive: 2 }),
      recurringMinorByCurrency: { USD: 4900, JMD: 750000 },
    });
    expect(mixed.revenue.recurringMinorByCurrency).toEqual({ USD: 4900, JMD: 750000 });
    expect(mixed.revenue.payingCustomers).toBe(2);
  });

  it('reports the end-to-end rate from sourced to serving', () => {
    expect(report.rates.endToEndRate).toBe(percent(1, 40));
  });
});

/**
 * A metric nobody records is not zero. Naming the gap makes it a decision
 * rather than an oversight, and these must close before the pilot can claim a
 * complete cost record.
 */
describe('metrics with no recorded source', () => {
  it('names them instead of defaulting them to zero', () => {
    const report = buildFunnel({ counts: counts({ sourced: 10, entitlementsActive: 1 }) });
    expect(report.unavailable).toContain('provider_cost');
    expect(report.unavailable).toContain('satisfaction');
  });

  /**
   * `time_per_stage` was in the unavailable list because nothing recorded it.
   * It is now derived from timestamps the pilot already writes, so listing it
   * as unavailable would be a stale claim — the list is computed from what is
   * actually missing rather than fixed.
   */
  it('no longer claims a derived metric is unavailable', () => {
    const report = buildFunnel({ counts: counts({ sourced: 10 }) });
    expect(UNAVAILABLE_METRICS).toContain('time_per_stage');
    expect(report.unavailable).not.toContain('time_per_stage');
  });

  it('reports no margin while cost is unmeasured', () => {
    const report = buildFunnel({ counts: counts({ entitlementsActive: 1 }) });
    expect(Object.keys(report.rates)).not.toContain('grossMargin');
    expect(report.unavailable).toContain('labour_cost');
    expect(report.grossMarginMinorByCurrency).toBeNull();
  });
});

/** "Channel sequence contribution (not assumed causation)." */
describe('channel contribution', () => {
  const result = channelContribution([
    { channel: 'email', sent: 6, delivered: 5, replied: 2 },
    { channel: 'sms', sent: 2, delivered: 2, replied: 0 },
  ]);

  it('reports counts and a per-channel reply rate', () => {
    expect(result.channels[0]).toMatchObject({ channel: 'email', replyRate: 40 });
    expect(result.channels[1]).toMatchObject({ channel: 'sms', replyRate: 0 });
  });

  it('states plainly that it attributes nothing', () => {
    expect(result.attribution).toBe('none');
    expect(result.note).toMatch(/not attributed/i);
  });

  it('leaves a channel with no deliveries as unknown, not zero', () => {
    const none = channelContribution([{ channel: 'phone', sent: 0, delivered: 0, replied: 0 }]);
    expect(none.channels[0].replyRate).toBeNull();
  });
});
