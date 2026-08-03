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

/**
 * Metrics the specification asks for that nothing in Atlas records.
 *
 * Named rather than omitted: a missing row on a dashboard reads as an oversight,
 * while a named gap reads as a decision — and these have to be closed before the
 * pilot can claim a complete cost record.
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
  /** Named gaps; see UNAVAILABLE_METRICS. */
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

  return {
    stages,
    rates,
    revenue: {
      recurringMinorByCurrency: { ...(args.recurringMinorByCurrency ?? {}) },
      payingCustomers: c.entitlementsActive,
    },
    unavailable: [...UNAVAILABLE_METRICS],
    empty: c.sourced === 0,
  };
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
