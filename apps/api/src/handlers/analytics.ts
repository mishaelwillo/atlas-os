/**
 * analytics.funnel (docs/specs/p2/revenue-pilot.md).
 *
 * Reads every stage the pilot passes through and reports what actually
 * happened. The arithmetic lives in revenue/funnel.ts, which is where the rule
 * that an unknown rate is null rather than zero is enforced; this file's job is
 * to count honestly and to leave a stage at zero when its table is empty rather
 * than when it could not be read.
 *
 * The counts come from tables migration 0006 and earlier create. Until those
 * are applied the whole report is `schema_pending`, because a partial funnel —
 * some stages counted, others silently zero — would read as a funnel where
 * everybody dropped out.
 */
import type { CapabilityHandler } from '../pipeline.js';
import type { Queryable } from '../db.js';
import {
  buildFunnel,
  channelContribution,
  type ChannelCount,
  type CostRollup,
  type StageCounts,
} from '../revenue/funnel.js';

const UNDEFINED_TABLE = '42P01';

export function isMissingTable(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === UNDEFINED_TABLE;
}

function n(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export interface FunnelData {
  counts: StageCounts;
  channels: ChannelCount[];
  recurringMinorByCurrency: Record<string, number>;
  /** Why prospects were not qualified, most common first. */
  topBlockers: Array<{ code: string; count: number }>;
  /**
   * Recorded costs and outcomes.
   *
   * Absent — not zero — when migration 0012 has not been applied. An empty
   * rollup would report a complete-looking zero cost record; absence keeps the
   * funnel saying the metrics have no source, which is the truth.
   */
  cost?: CostRollup;
}

/**
 * Count every stage in one pass per table.
 *
 * Space scoping is applied by the caller's transaction (RLS) plus the explicit
 * predicate, matching how the other status queries work: an operator with no
 * pinned space sees every space, anyone else sees theirs.
 */
export async function readFunnel(q: Queryable, space: string | null): Promise<FunnelData> {
  const [leads, assessments, demos, sequences, touches, offers, deals, interested, entitlements, revenue, blockers] =
    await Promise.all([
      q.query(
        `select count(*)::int as n from leads where ($1::uuid is null or space_id = $1::uuid)`,
        [space],
      ),
      /*
       * The latest assessment per lead is the standing verdict; counting every
       * row would count a prospect once per re-assessment and make the
       * qualification rate drift with how often people re-check.
       */
      q.query(
        `select verdict, count(*)::int as n from (
           select distinct on (lead_id) lead_id, verdict
             from qualification_assessments
            where ($1::uuid is null or space_id = $1::uuid)
            order by lead_id, created_at desc
         ) latest group by verdict`,
        [space],
      ),
      q.query(
        `select state, count(*)::int as n from demo_queue
          where ($1::uuid is null or space_id = $1::uuid) group by state`,
        [space],
      ),
      q.query(
        `select count(*)::int as n from outreach_sequences
          where ($1::uuid is null or space_id = $1::uuid)`,
        [space],
      ),
      q.query(
        `select state, channel, count(*)::int as n from outreach_touches
          where ($1::uuid is null or space_id = $1::uuid) group by state, channel`,
        [space],
      ),
      q.query(
        `select count(distinct lead_id)::int as n from offers
          where ($1::uuid is null or space_id = $1::uuid)`,
        [space],
      ),
      q.query(
        `select state, count(*)::int as n from (
           select distinct on (lead_id) lead_id, state
             from deal_decisions
            where ($1::uuid is null or space_id = $1::uuid)
            order by lead_id, created_at desc
         ) latest group by state`,
        [space],
      ),
      /*
       * Interest is counted from history, not from the standing state.
       * `deal_decisions` is append-only, so a lead that has since moved to
       * discovery still has its interest row — counting only the standing
       * state would make recorded interest fall as deals progressed, which is
       * the same mistake the touch counting avoids.
       */
      q.query(
        `select count(distinct lead_id)::int as n from deal_decisions
          where state = 'interested' and ($1::uuid is null or space_id = $1::uuid)`,
        [space],
      ),
      q.query(
        `select state, count(*)::int as n from hosting_entitlements
          where ($1::uuid is null or space_id = $1::uuid) group by state`,
        [space],
      ),
      /*
       * Only entitlements actually being served contribute revenue, and only at
       * the price of the offer version they are on. Currencies are grouped, not
       * summed: adding USD to JMD would produce a number that means nothing.
       */
      q.query(
        `select o.currency, sum(o.price_minor)::bigint as minor
           from hosting_entitlements h
           join offers o on o.offer_id = h.offer_id
          where h.state in ('entitlement_active', 'onboarded', 'active')
            and ($1::uuid is null or h.space_id = $1::uuid)
          group by o.currency`,
        [space],
      ),
      q.query(
        `select b->>'code' as code, count(*)::int as n
           from (
             select distinct on (lead_id) lead_id, blockers
               from qualification_assessments
              where ($1::uuid is null or space_id = $1::uuid)
              order by lead_id, created_at desc
           ) latest, jsonb_array_elements(latest.blockers) as b
          group by 1 order by 2 desc limit 5`,
        [space],
      ),
    ]);

  const byVerdict = new Map(assessments.rows.map((r) => [String(r.verdict), n(r.n)]));
  const byDemoState = new Map(demos.rows.map((r) => [String(r.state), n(r.n)]));
  const byDealState = new Map(deals.rows.map((r) => [String(r.state), n(r.n)]));
  const byEntitlement = new Map(entitlements.rows.map((r) => [String(r.state), n(r.n)]));

  const touchRows = touches.rows.map((r) => ({
    state: String(r.state),
    channel: String(r.channel),
    n: n(r.n),
  }));
  const sumByState = (...states: string[]) =>
    touchRows.filter((r) => states.includes(r.state)).reduce((s, r) => s + r.n, 0);

  /*
   * A touch that replied was necessarily sent and delivered first, but its row
   * only carries its current state. Counting `sent` alone would show sends
   * falling as replies arrive, so every state at or past a milestone counts
   * toward it.
   */
  const PAST_SENT = ['sent', 'delivered', 'failed', 'replied', 'no_reply', 'suppressed'];
  const PAST_DELIVERED = ['delivered', 'replied', 'no_reply', 'suppressed'];

  const channels = [...new Set(touchRows.map((r) => r.channel))].sort().map((channel) => {
    const forChannel = touchRows.filter((r) => r.channel === channel);
    const count = (states: string[]) =>
      forChannel.filter((r) => states.includes(r.state)).reduce((s, r) => s + r.n, 0);
    return {
      channel,
      sent: count(PAST_SENT),
      delivered: count(PAST_DELIVERED),
      replied: count(['replied']),
    };
  });

  const entitled = ['entitlement_active', 'onboarded', 'active', 'past_due'];

  return {
    counts: {
      sourced: n(leads.rows[0]?.n),
      assessed: [...byVerdict.values()].reduce((s, v) => s + v, 0),
      qualified: byVerdict.get('qualified') ?? 0,
      inReview: byVerdict.get('eligibility_review') ?? 0,
      disqualified: byVerdict.get('disqualified') ?? 0,
      demosQueued: [...byDemoState.entries()]
        .filter(([state]) => state !== 'expired')
        .reduce((s, [, v]) => s + v, 0),
      demosShareable: byDemoState.get('shareable') ?? 0,
      sequencesPlanned: n(sequences.rows[0]?.n),
      touchesSent: sumByState(...PAST_SENT),
      touchesDelivered: sumByState(...PAST_DELIVERED),
      replied: sumByState('replied'),
      suppressed: sumByState('suppressed'),
      offersPublished: n(offers.rows[0]?.n),
      dealsInterested: n(interested.rows[0]?.n),
      dealsAccepted: byDealState.get('accepted') ?? 0,
      dealsDeclined: byDealState.get('declined') ?? 0,
      entitlementsActive: entitled.reduce((s, k) => s + (byEntitlement.get(k) ?? 0), 0),
      entitlementsCancelled: byEntitlement.get('cancelled') ?? 0,
    },
    channels,
    recurringMinorByCurrency: Object.fromEntries(
      revenue.rows.map((r) => [String(r.currency), n(r.minor)]),
    ),
    topBlockers: blockers.rows.map((r) => ({ code: String(r.code), count: n(r.n) })),
    cost: await readCostRollup(q, space),
  };
}

/**
 * Recorded costs and outcomes, or undefined when migration 0012 is not applied.
 *
 * Undefined rather than an empty rollup: an empty one would present as a
 * complete zero-cost record, and the funnel would report a gross margin equal
 * to revenue. Absence keeps it saying the metrics have no source.
 */
async function readCostRollup(q: Queryable, space: string | null): Promise<CostRollup | undefined> {
  try {
    const [money, minutes, satisfaction] = await Promise.all([
      q.query(
        `select currency, sum(amount_minor)::int as minor from pilot_cost_entries
          where amount_minor is not null and ($1::uuid is null or space_id = $1::uuid)
          group by currency`,
        [space],
      ),
      q.query(
        `select category, sum(minutes)::int as total, count(*)::int as entries
           from pilot_cost_entries
          where ($1::uuid is null or space_id = $1::uuid)
          group by category`,
        [space],
      ),
      q.query(
        `select avg(satisfaction)::float as mean, count(*)::int as n from pilot_outcomes
          where ($1::uuid is null or space_id = $1::uuid)`,
        [space],
      ),
    ]);

    const minutesByCategory: Record<string, number> = {};
    const categoriesRecorded: string[] = [];
    for (const row of minutes.rows) {
      const category = String(row.category);
      categoriesRecorded.push(category);
      // Only categories that actually logged time get a minutes figure; a
      // provider charge in money must not appear as zero minutes.
      if (row.total !== null) minutesByCategory[category] = n(row.total);
    }

    const mean = satisfaction.rows[0]?.mean;
    return {
      minorByCurrency: Object.fromEntries(
        money.rows.map((r) => [String(r.currency), n(r.minor)]),
      ),
      minutesByCategory,
      categoriesRecorded,
      satisfactionAverage:
        typeof mean === 'number' && Number.isFinite(mean) ? Math.round(mean * 100) / 100 : null,
      satisfactionCount: n(satisfaction.rows[0]?.n),
    };
  } catch (err) {
    if (isMissingTable(err)) return undefined;
    throw err;
  }
}

/**
 * analytics.funnel — the pilot's funnel, end to end.
 *
 * Read-only. It is also the export surface the specification asks for, which is
 * why it returns the whole report rather than a card-shaped subset.
 */
export const analyticsFunnel: CapabilityHandler = async (ctx) => {
  let data: FunnelData;
  try {
    data = await readFunnel(ctx.q, ctx.spaceId);
  } catch (err) {
    if (isMissingTable(err)) {
      return {
        status: 'schema_pending',
        note: 'the funnel spans tables that migrations 0004 through 0006 create; some are not applied, and a partial funnel would read as one where everybody dropped out',
      };
    }
    throw err;
  }

  const report = buildFunnel({
    counts: data.counts,
    recurringMinorByCurrency: data.recurringMinorByCurrency,
    cost: data.cost,
  });

  return {
    ...report,
    channelContribution: channelContribution(data.channels),
    topBlockers: data.topBlockers,
    status: 'ok',
  };
};
