/**
 * The revenue pilot's operator surface, as declarative card data
 * (docs/specs/p2/revenue-pilot.md, brief §5).
 *
 * Mission Control renders `status.mission_control` and does not fetch its own
 * data, so every fact the P2C cards display has to arrive here. This module is
 * the read half of that: one pass per table, joined per lead in application
 * code, plus the vocabularies the forms need — states, channels, disclosures —
 * so the UI never has to guess what the API will accept.
 *
 * Those vocabularies are DERIVED from the rule functions rather than restated.
 * A second hand-written copy of a transition table is a claim about the rules
 * that nothing checks; the first time it drifted, an operator would be offered
 * a move the API refuses.
 *
 * The tables come from migrations 0004 through 0006. If any is missing the
 * whole pipeline reports unavailable rather than rendering a partial one —
 * a prospect list with no demo states looks like a pilot where nothing was
 * ever queued, which is exactly the lie the funnel refuses to tell.
 */
import type { Queryable } from '../db.js';
import {
  DEMO_QUEUE_CAP,
  DEMO_QUEUE_FLOOR,
  DEMO_STATES,
  permittedDemoMoves,
} from '../revenue/demo-queue.js';
import {
  MAX_SEQUENCE_STEPS,
  MIN_TOUCH_SPACING_HOURS,
  OUTREACH_CHANNELS,
  permittedTouchMoves,
} from '../revenue/sequence.js';
import {
  DEAL_STATES,
  OFFER_PERIODS,
  REQUIRED_DISCLOSURES,
  permittedDealMoves,
} from '../revenue/offers.js';
import { isEntitled, isHostingState } from '../revenue/hosting-activation.js';
import {
  MAX_DEMO_EFFORT_HOURS,
  QUALIFYING_SCORE,
  MAX_SCORE,
  SCORE_DIMENSIONS,
  assessmentExpired,
} from '../revenue/qualification.js';

/** How many leads a card carries. The pilot runs one bounded cohort at a time. */
const LEAD_LIMIT = 50;

export interface PipelineQualification {
  verdict: string;
  total: number;
  assessedAt: string;
  expiresAt: string;
  /** A stale verdict cannot take a demo slot, so it is shown as stale. */
  expired: boolean;
}

export interface PipelineDemo {
  queueId: string;
  state: string;
  siteId: string | null;
  expiresAt: string;
  /** Derived from planAdvance; empty means this demo cannot move again. */
  moves: string[];
}

export interface PipelineTouch {
  touchId: string;
  step: number;
  channel: string;
  state: string;
  sentAt: string | null;
  /** Derived from planTouchAdvance; never contains `sent`. */
  moves: Array<{ state: string; requiresApproval: boolean }>;
}

export interface PipelineSequence {
  sequenceId: string;
  version: number;
  state: string;
  stoppedReason: string | null;
  touches: PipelineTouch[];
}

export interface PipelineOffer {
  offerId: string;
  version: number;
  country: string;
  currency: string;
  priceMinor: number;
  period: string;
  termsVersion: string;
}

export interface PipelineDeal {
  state: string;
  offerVersion: number | null;
  decidedAt: string;
}

export interface PipelineEntitlement {
  entitlementId: string;
  state: string;
  offerVersion: number;
  /** Whether a provider reference exists — never the reference itself. */
  paymentRecorded: boolean;
  renewalEnabled: boolean;
  entitled: boolean;
  activatedAt: string | null;
  cancelledAt: string | null;
  servesUntil: string | null;
}

export interface PipelineLead {
  leadId: string;
  businessName: string;
  leadStatus: string;
  qualification: PipelineQualification | null;
  demo: PipelineDemo | null;
  sequence: PipelineSequence | null;
  offer: PipelineOffer | null;
  deal: PipelineDeal | null;
  /**
   * Derived from planDealTransition. Empty means the deal is decided.
   * A deal nobody has recorded yet starts at `interested`, which is what the
   * handler assumes too, so the offered moves match what it would accept.
   */
  dealMoves: string[];
  entitlement: PipelineEntitlement | null;
}

export interface PipelineQueue {
  active: number;
  cap: number;
  floor: number;
  remaining: number;
  belowFloor: boolean;
}

export interface Pipeline {
  leads: PipelineLead[];
  queue: PipelineQueue;
}

function iso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/**
 * Read the pilot pipeline for one space, or every space for an operator with
 * none pinned — the same scoping every other status query uses.
 *
 * Each `distinct on` picks the standing row per lead in one pass. The latest
 * assessment is the standing verdict and the latest decision is the standing
 * one; earlier rows are history, and counting or displaying them as current
 * would make a re-assessed prospect look like several.
 */
export async function readPipeline(q: Queryable, space: string | null): Promise<Pipeline> {
  const [leads, assessments, demos, sequences, touches, offers, deals, entitlements] =
    await Promise.all([
      q.query(
        `select lead_id, business_name, status, created_at
           from leads where ($1::uuid is null or space_id = $1::uuid)
          order by created_at desc limit ${LEAD_LIMIT}`,
        [space],
      ),
      q.query(
        `select distinct on (lead_id) lead_id, verdict, total, created_at, expires_at
           from qualification_assessments
          where ($1::uuid is null or space_id = $1::uuid)
          order by lead_id, created_at desc`,
        [space],
      ),
      /*
       * Expired slots are excluded because they no longer occupy the cap, and
       * the queue count below has to mean the same thing the enqueue rule
       * means by it.
       */
      q.query(
        `select queue_id, lead_id, state, site_id, expires_at
           from demo_queue
          where state <> 'expired' and ($1::uuid is null or space_id = $1::uuid)`,
        [space],
      ),
      q.query(
        `select distinct on (lead_id) lead_id, sequence_id, version, state, stopped_reason
           from outreach_sequences
          where ($1::uuid is null or space_id = $1::uuid)
          order by lead_id, version desc`,
        [space],
      ),
      q.query(
        `select touch_id, sequence_id, step, channel, state, sent_at
           from outreach_touches
          where ($1::uuid is null or space_id = $1::uuid)
          order by sequence_id, step`,
        [space],
      ),
      q.query(
        `select distinct on (lead_id) lead_id, offer_id, version, country, currency,
                price_minor, period, terms_version
           from offers
          where ($1::uuid is null or space_id = $1::uuid)
          order by lead_id, version desc`,
        [space],
      ),
      q.query(
        `select distinct on (lead_id) lead_id, state, offer_version, created_at
           from deal_decisions
          where ($1::uuid is null or space_id = $1::uuid)
          order by lead_id, created_at desc`,
        [space],
      ),
      q.query(
        `select distinct on (lead_id) lead_id, entitlement_id, state, offer_version,
                payment_reference is not null as paid, renewal_enabled,
                activated_at, cancelled_at, serves_until
           from hosting_entitlements
          where ($1::uuid is null or space_id = $1::uuid)
          order by lead_id, created_at desc`,
        [space],
      ),
    ]);

  const now = new Date();

  const byLeadAssessment = new Map<string, PipelineQualification>();
  for (const r of assessments.rows) {
    const expiresAt = iso(r.expires_at);
    const assessedAt = iso(r.created_at);
    if (expiresAt === null || assessedAt === null) continue;
    byLeadAssessment.set(String(r.lead_id), {
      verdict: String(r.verdict),
      total: Number(r.total),
      assessedAt,
      expiresAt,
      expired: assessmentExpired(expiresAt, now),
    });
  }

  const byLeadDemo = new Map<string, PipelineDemo>();
  for (const r of demos.rows) {
    const state = String(r.state);
    byLeadDemo.set(String(r.lead_id), {
      queueId: String(r.queue_id),
      state,
      siteId: r.site_id === null || r.site_id === undefined ? null : String(r.site_id),
      expiresAt: iso(r.expires_at) ?? '',
      moves: permittedDemoMoves(state),
    });
  }

  const touchesBySequence = new Map<string, Array<Record<string, unknown>>>();
  for (const r of touches.rows) {
    const key = String(r.sequence_id);
    const list = touchesBySequence.get(key) ?? [];
    list.push(r);
    touchesBySequence.set(key, list);
  }

  const byLeadSequence = new Map<string, PipelineSequence>();
  for (const r of sequences.rows) {
    const sequenceId = String(r.sequence_id);
    const sequenceState = String(r.state);
    byLeadSequence.set(String(r.lead_id), {
      sequenceId,
      version: Number(r.version),
      state: sequenceState,
      stoppedReason: r.stopped_reason ? String(r.stopped_reason) : null,
      touches: (touchesBySequence.get(sequenceId) ?? []).map((t) => ({
        touchId: String(t.touch_id),
        step: Number(t.step),
        channel: String(t.channel),
        state: String(t.state),
        sentAt: iso(t.sent_at),
        moves: permittedTouchMoves({ sequenceState, from: String(t.state) }),
      })),
    });
  }

  const byLeadOffer = new Map<string, PipelineOffer>();
  for (const r of offers.rows) {
    byLeadOffer.set(String(r.lead_id), {
      offerId: String(r.offer_id),
      version: Number(r.version),
      country: String(r.country),
      currency: String(r.currency),
      priceMinor: Number(r.price_minor),
      period: String(r.period),
      termsVersion: String(r.terms_version),
    });
  }

  const byLeadDeal = new Map<string, PipelineDeal>();
  for (const r of deals.rows) {
    byLeadDeal.set(String(r.lead_id), {
      state: String(r.state),
      offerVersion:
        r.offer_version === null || r.offer_version === undefined ? null : Number(r.offer_version),
      decidedAt: iso(r.created_at) ?? '',
    });
  }

  const byLeadEntitlement = new Map<string, PipelineEntitlement>();
  for (const r of entitlements.rows) {
    const state = String(r.state);
    byLeadEntitlement.set(String(r.lead_id), {
      entitlementId: String(r.entitlement_id),
      state,
      offerVersion: Number(r.offer_version),
      paymentRecorded: r.paid === true,
      renewalEnabled: r.renewal_enabled === true,
      // Derived from the state so it cannot disagree with the row it describes.
      entitled: isHostingState(state) ? isEntitled(state) : false,
      activatedAt: iso(r.activated_at),
      cancelledAt: iso(r.cancelled_at),
      servesUntil: iso(r.serves_until),
    });
  }

  const rows: PipelineLead[] = leads.rows.map((r) => {
    const leadId = String(r.lead_id);
    const deal = byLeadDeal.get(leadId) ?? null;
    const offer = byLeadOffer.get(leadId) ?? null;
    return {
      leadId,
      businessName: String(r.business_name ?? ''),
      leadStatus: String(r.status ?? ''),
      qualification: byLeadAssessment.get(leadId) ?? null,
      demo: byLeadDemo.get(leadId) ?? null,
      sequence: byLeadSequence.get(leadId) ?? null,
      offer,
      deal,
      dealMoves: permittedDealMoves({
        from: deal?.state ?? 'interested',
        offerVersion: offer?.version ?? null,
      }),
      entitlement: byLeadEntitlement.get(leadId) ?? null,
    };
  });

  /*
   * The queue counts every active slot in scope, not only the ones belonging
   * to a lead on this page. The cap is global to the pilot, so a count that
   * silently excluded slots past the lead limit would tell an operator there
   * was room when there was not.
   */
  const active = demos.rows.length;

  return {
    leads: rows,
    queue: {
      active,
      cap: DEMO_QUEUE_CAP,
      floor: DEMO_QUEUE_FLOOR,
      remaining: Math.max(0, DEMO_QUEUE_CAP - active),
      belowFloor: active < DEMO_QUEUE_FLOOR,
    },
  };
}

/**
 * The rubric the qualification form collects for, published rather than
 * duplicated in the UI. The thresholds are the ones the assessment actually
 * applies, so a form cannot describe a rule the rubric does not hold.
 */
export const QUALIFICATION_RUBRIC = {
  dimensions: [...SCORE_DIMENSIONS],
  maxScore: MAX_SCORE,
  qualifyingScore: QUALIFYING_SCORE,
  maxDemoEffortHours: MAX_DEMO_EFFORT_HOURS,
} as const;

/** Vocabularies the prospecting card's controls are built from. */
export const PROSPECTING_VOCABULARY = {
  demoStates: [...DEMO_STATES],
  rubric: QUALIFICATION_RUBRIC,
} as const;

/** Vocabularies the sequence card's controls are built from. */
export const SEQUENCE_VOCABULARY = {
  channels: [...OUTREACH_CHANNELS],
  maxSteps: MAX_SEQUENCE_STEPS,
  minSpacingHours: MIN_TOUCH_SPACING_HOURS,
} as const;

/** Vocabularies the revenue-operations card's controls are built from. */
export const REVENUE_VOCABULARY = {
  dealStates: [...DEAL_STATES],
  periods: [...OFFER_PERIODS],
  requiredDisclosures: [...REQUIRED_DISCLOSURES],
} as const;
