/**
 * Funnel analytics (docs/specs/p2/revenue-pilot.md).
 *
 * The pilot's exit criterion is "one paying customer and complete cost/support/
 * outcome record", and — the part that shapes this module — "zero customers is
 * recorded as evidence, not concealed". So the arithmetic here is built to make
 * an empty funnel legible rather than flattering, and to refuse three specific
 * lies:
 *
 * 1. **A rate with no denominator is not zero.** Nothing entering a stage means
 *    its conversion is unknown, not 0%. A dashboard reading "0% reply rate" on
 *    a pilot that has sent nothing is worse than one reading "—", because the
 *    first invites someone to fix the messaging.
 * 2. **A metric nobody records is not zero either.** Provider cost, labour,
 *    support time and satisfaction have no source in the schema, so they are
 *    reported as unavailable by name rather than defaulted to 0 and quietly
 *    included in a margin.
 * 3. **Channel counts are not attribution.** The specification asks for
 *    "channel sequence contribution (not assumed causation)", so per-channel
 *    numbers are reported as counts and never as a conversion each channel
 *    caused.
 *
 * Pure and deterministic — no clock, no database.
 */

/**
 * A ratio, or null when the denominator is zero.
 *
 * Null is the whole point: it is "we cannot know from what happened", which a
 * caller must render as unknown rather than as a number.
 */
export function rate(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return null;
  if (denominator <= 0) return null;
  return numerator / denominator;
}

/** A ratio rounded for display, still null when it cannot be computed. */
export function percent(numerator: number, denominator: number): number | null {
  const value = rate(numerator, denominator);
  return value === null ? null : Math.round(value * 1000) / 10;
}

import { assessRecord, grossMargin, type RecordCompleteness } from './pilot-record.js';

/**
 * Every metric the specification asks for that Atlas once could not record.
 *
 * Kept as the historical full set — `time_per_stage` is now derived from
 * timestamps and the other five are recordable, so this is no longer what the
 * report emits. The live list is derived from what is actually missing, because
 * a fixed list would keep calling a metric unavailable after somebody had
 * recorded it.
 */
export const UNAVAILABLE_METRICS = [
  'provider_cost',
  'labour_cost',
  'support_time',
  'satisfaction',
  'time_per_stage',
  'demo_cost',
] as const;

export interface StageCounts {
  /** Leads that exist at all. */
  sourced: number;
  assessed: number;
  qualified: number;
  inReview: number;
  disqualified: number;
  demosQueued: number;
  demosShareable: number;
  sequencesPlanned: number;
  touchesSent: number;
  touchesDelivered: number;
  replied: number;
  suppressed: number;
  offersPublished: number;
  /**
   * Leads with a recorded expression of interest, counted from history rather
   * than from the standing state — `deal_decisions` is append-only, so a deal
   * that has since moved to discovery keeps its interest row and the count
   * does not fall as deals progress.
   */
  dealsInterested: number;
  dealsAccepted: number;
  dealsDeclined: number;
  entitlementsActive: number;
  entitlementsCancelled: number;
}

export interface FunnelStage {
  id: string;
  label: string;
  count: number;
  /** Conversion from the previous stage; null when nothing reached it. */
  conversionPercent: number | null;
  /** What the conversion is measured against, so the number is readable. */
  of: string | null;
}

export interface FunnelReport {
  stages: FunnelStage[];
  /** Ratios that answer the pilot's questions directly. */
  rates: Record<string, number | null>;
  /** Recurring revenue from entitlements that are actually being served. */
  revenue: {
    /** Minor units, by currency. Mixed currencies are never summed. */
    recurringMinorByCurrency: Record<string, number>;
    payingCustomers: number;
  };
  /**
   * The cost, support and outcome record P2C's exit criterion asks for.
   *
   * Money and minutes sit side by side and are never summed into one another:
   * no hourly rate exists in Atlas, and inventing one would make the margin
   * look complete while being made up.
   */
  costRecord: {
    minorByCurrency: Record<string, number>;
    minutesByCategory: Record<string, number>;
    /** Mean satisfaction, or null when nobody has been asked. */
    satisfaction: number | null;
    satisfactionCount: number;
    /** Derived, never declared: every category recorded, plus a satisfaction. */
    complete: boolean;
    missingCategories: string[];
    satisfactionMissing: boolean;
  };
  /** Null until the cost record is complete; a partial margin is always too high. */
  grossMarginMinorByCurrency: Record<string, number> | null;
  grossMarginUnavailableReason: string | null;
  /** Metrics that still have no source, derived from what is actually missing. */
  unavailable: string[];
  /** True when nothing has entered the funnel at all. */
  empty: boolean;
}

/**
 * Build the funnel report.
 *
 * Every conversion names the stage it is measured against, because "42%" with
 * no denominator is the kind of number that gets quoted back without its
 * meaning.
 */
export function buildFunnel(args: {
  counts: StageCounts;
  /** Recurring price by currency, already filtered to served entitlements. */
  recurringMinorByCurrency?: Record<string, number>;
  /** Recorded costs and outcomes; absent before migration 0012 is applied. */
  cost?: CostRollup;
}): FunnelReport {
  const c = args.counts;

  const stages: FunnelStage[] = [
    { id: 'sourced', label: 'Sourced', count: c.sourced, conversionPercent: null, of: null },
    {
      id: 'assessed',
      label: 'Assessed',
      count: c.assessed,
      conversionPercent: percent(c.assessed, c.sourced),
      of: 'sourced',
    },
    {
      id: 'qualified',
      label: 'Qualified',
      count: c.qualified,
      conversionPercent: percent(c.qualified, c.assessed),
      of: 'assessed',
    },
    {
      id: 'demo_queued',
      label: 'Demo queued',
      count: c.demosQueued,
      conversionPercent: percent(c.demosQueued, c.qualified),
      of: 'qualified',
    },
    {
      id: 'demo_shareable',
      label: 'Demo shareable',
      count: c.demosShareable,
      conversionPercent: percent(c.demosShareable, c.demosQueued),
      of: 'demo_queued',
    },
    {
      id: 'touch_sent',
      label: 'Touch sent',
      count: c.touchesSent,
      conversionPercent: percent(c.touchesSent, c.demosShareable),
      of: 'demo_shareable',
    },
    {
      id: 'replied',
      label: 'Replied',
      count: c.replied,
      conversionPercent: percent(c.replied, c.touchesDelivered),
      of: 'touch_delivered',
    },
    /*
     * Recorded interest is a floor, not a gate.
     *
     * A first decision may skip straight to discovery or declined — nobody has
     * to invent an expression of interest they did not get — so a deal can
     * reach an offer without ever passing through a recorded `interested`.
     * That is why the next stage is still measured against `replied` rather
     * than against this: dividing offers by interest would imply every offer
     * came through a recorded one, and would read over 100% the first time an
     * operator skipped the step.
     */
    {
      id: 'interested',
      label: 'Interest recorded',
      count: c.dealsInterested,
      conversionPercent: percent(c.dealsInterested, c.replied),
      of: 'replied',
    },
    {
      id: 'offer_published',
      label: 'Offer published',
      count: c.offersPublished,
      conversionPercent: percent(c.offersPublished, c.replied),
      of: 'replied',
    },
    {
      id: 'accepted',
      label: 'Terms accepted',
      count: c.dealsAccepted,
      conversionPercent: percent(c.dealsAccepted, c.offersPublished),
      of: 'offer_published',
    },
    {
      id: 'hosting_active',
      label: 'Hosting active',
      count: c.entitlementsActive,
      conversionPercent: percent(c.entitlementsActive, c.dealsAccepted),
      of: 'accepted',
    },
  ];

  const rates: Record<string, number | null> = {
    qualificationRate: percent(c.qualified, c.assessed),
    disqualificationRate: percent(c.disqualified, c.assessed),
    reviewBacklogRate: percent(c.inReview, c.assessed),
    deliveryRate: percent(c.touchesDelivered, c.touchesSent),
    replyRate: percent(c.replied, c.touchesDelivered),
    optOutRate: percent(c.suppressed, c.touchesDelivered),
    acceptanceRate: percent(c.dealsAccepted, c.offersPublished),
    activationRate: percent(c.entitlementsActive, c.dealsAccepted),
    // Churn measured against everyone who was ever entitled, not against the
    // survivors — dividing by the survivors would shrink as customers leave.
    churnRate: percent(c.entitlementsCancelled, c.entitlementsActive + c.entitlementsCancelled),
    endToEndRate: percent(c.entitlementsActive, c.sourced),
  };

  const recurring = { ...(args.recurringMinorByCurrency ?? {}) };
  const cost = args.cost ?? EMPTY_COST;
  const completeness = assessRecord({
    categoriesRecorded: cost.categoriesRecorded,
    hasSatisfaction: cost.satisfactionCount > 0,
  });
  const margin = grossMargin({
    recurringMinorByCurrency: recurring,
    costMinorByCurrency: cost.minorByCurrency,
    costRecordComplete: completeness.complete,
  });

  return {
    stages,
    rates,
    revenue: {
      recurringMinorByCurrency: recurring,
      payingCustomers: c.entitlementsActive,
    },
    /*
     * The cost, support and outcome record P2C's exit criterion asks for.
     *
     * Money and minutes are reported side by side and never summed: no hourly
     * rate exists in Atlas, and inventing one to produce a single figure would
     * make the margin look complete while being made up.
     */
    costRecord: {
      minorByCurrency: cost.minorByCurrency,
      minutesByCategory: cost.minutesByCategory,
      satisfaction: cost.satisfactionAverage,
      satisfactionCount: cost.satisfactionCount,
      complete: completeness.complete,
      missingCategories: completeness.missingCategories,
      satisfactionMissing: completeness.satisfactionMissing,
    },
    grossMarginMinorByCurrency: margin.grossMarginMinorByCurrency,
    grossMarginUnavailableReason: margin.unavailableReason,
    /*
     * What still has no source. Four of the original six now do; the list
     * shrinks as the record fills rather than being deleted wholesale, so a
     * partially-recorded pilot still says which parts are missing.
     */
    unavailable: completeness.complete ? [] : unavailableMetrics(completeness),
    empty: c.sourced === 0,
  };
}

/** No cost record at all — the state before migration 0012 is applied. */
const EMPTY_COST: CostRollup = {
  minorByCurrency: {},
  minutesByCategory: {},
  categoriesRecorded: [],
  satisfactionAverage: null,
  satisfactionCount: 0,
};

export interface CostRollup {
  /** Recorded money, per currency. Never summed across currencies. */
  minorByCurrency: Record<string, number>;
  /** Recorded time, per category. Never converted to money. */
  minutesByCategory: Record<string, number>;
  /** Which cost categories have at least one entry. */
  categoriesRecorded: string[];
  /** Mean satisfaction, or null when nobody has been asked. */
  satisfactionAverage: number | null;
  satisfactionCount: number;
}

/**
 * The metrics that still have no source, named individually.
 *
 * `UNAVAILABLE_METRICS` was a fixed list because nothing recorded any of them.
 * Now that four are recordable, a fixed list would keep claiming they are
 * unavailable after they had been recorded — the same shape of stale claim
 * this codebase keeps finding. It is derived from what is actually missing.
 */
function unavailableMetrics(completeness: RecordCompleteness): string[] {
  const byCategory: Record<string, string> = {
    provider: 'provider_cost',
    labour: 'labour_cost',
    support: 'support_time',
    demo: 'demo_cost',
  };
  const missing = completeness.missingCategories.map((c) => byCategory[c]);
  return completeness.satisfactionMissing ? [...missing, 'satisfaction'] : missing;
}

export interface ChannelCount {
  channel: string;
  sent: number;
  delivered: number;
  replied: number;
}

/**
 * Per-channel counts, explicitly not attribution.
 *
 * A reply arrives after some number of touches on some number of channels, and
 * nothing here can say which one caused it. The specification asks for channel
 * contribution "not assumed causation", so this reports what happened on each
 * channel and carries a flag saying that is all it is.
 */
export function channelContribution(rows: readonly ChannelCount[]): {
  channels: Array<ChannelCount & { replyRate: number | null }>;
  attribution: 'none';
  note: string;
} {
  return {
    channels: rows.map((r) => ({ ...r, replyRate: percent(r.replied, r.delivered) })),
    attribution: 'none',
    note: 'counts per channel; a reply is not attributed to any one touch',
  };
}
