/**
 * offers.*, deals.* and hosting.state handlers
 * (docs/specs/p2/revenue-pilot.md).
 *
 * Activation and cancellation are NOT here. Both are approval-gated and run
 * from dispatch.ts, because the specification says models cannot accept terms,
 * charge, or activate billing — so those two must sit behind a named human
 * decision like every other external commercial effect.
 *
 * These read and write `offers`, `deal_decisions` and `hosting_entitlements`,
 * which migration 0006 creates. Until it is applied they report
 * `schema_pending` and change nothing.
 */
import { CapabilityError, insertAudit, type CapabilityHandler } from '../pipeline.js';
import {
  REQUIRED_DISCLOSURES,
  planDealTransition,
  validateOffer,
  type OfferDraft,
} from '../revenue/offers.js';
import { isEntitled, isHostingState } from '../revenue/hosting-activation.js';

/** Postgres `undefined_table`; the one error meaning migration 0006 has not run. */
const UNDEFINED_TABLE = '42P01';

const SCHEMA_PENDING = {
  status: 'schema_pending' as const,
  note: 'migration 0006_offers_and_hosting has not been applied to this database, so nothing was read or written',
};

function isMissingTable(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === UNDEFINED_TABLE;
}

async function withSchema<T extends Record<string, unknown>>(
  run: () => Promise<T>,
): Promise<T | typeof SCHEMA_PENDING> {
  try {
    return await run();
  } catch (err) {
    if (isMissingTable(err)) return SCHEMA_PENDING;
    throw err;
  }
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function pending(outcome: Record<string, unknown>): boolean {
  return 'status' in outcome && outcome.status === 'schema_pending';
}

/**
 * offers.publish — record an immutable offer version.
 *
 * Nothing is defaulted. Country, currency, price, period and terms version are
 * all required, and every disclosure the specification names must carry text.
 * The presenter's figures are unvalidated research rather than Atlas price
 * policy, so there is no price to fall back on — and "free" must not be
 * indistinguishable from "nobody said".
 *
 * Offers are never edited. A change is a new version, because a business owner
 * accepts a specific price on specific terms and revising that in place would
 * rewrite what they agreed to.
 */
export const offersPublish: CapabilityHandler = async (ctx, input) => {
  const leadId = text(input.leadId);
  if (leadId === null) throw new CapabilityError(400, 'offers.publish: leadId is required');
  if (ctx.spaceId === null) {
    throw new CapabilityError(400, 'offers.publish requires a space (x-atlas-space)');
  }

  const lead = await ctx.q.query(`select lead_id from leads where lead_id = $1`, [leadId]);
  if (!lead.rows[0]) throw new CapabilityError(404, 'offers.publish: lead not found');

  const raw = typeof input.disclosures === 'object' && input.disclosures !== null
    ? (input.disclosures as Record<string, string>)
    : {};
  const draft: OfferDraft = {
    country: text(input.country) ?? '',
    currency: text(input.currency) ?? '',
    priceMinor: typeof input.priceMinor === 'number' ? input.priceMinor : Number.NaN,
    period: text(input.period) ?? '',
    disclosures: raw,
    termsVersion: text(input.termsVersion) ?? '',
  };

  const offer = validateOffer(draft);
  if (!offer.ok) {
    return {
      published: false,
      code: offer.code,
      note: offer.message,
      missing: offer.missing,
      required: [...REQUIRED_DISCLOSURES],
      status: 'refused',
    };
  }

  const outcome = await withSchema(async () => {
    // Version selection and insert are one statement so two concurrent
    // publishes cannot read the same max; the (lead_id, version) unique index
    // is the backstop if they somehow do.
    const res = await ctx.q.query(
      `insert into offers (space_id, lead_id, version, country, currency, price_minor, period, terms_version, disclosures, published_by)
       select $1, $2, coalesce(max(version), 0) + 1, $3, $4, $5, $6, $7, $8::jsonb, $9
         from offers where lead_id = $2
       returning offer_id, version`,
      [
        ctx.spaceId,
        leadId,
        offer.country,
        offer.currency,
        offer.priceMinor,
        offer.period,
        offer.termsVersion,
        JSON.stringify(offer.disclosures),
        ctx.auth.actor,
      ],
    );
    const row = res.rows[0];
    if (!row) throw new CapabilityError(500, 'offers.publish: offer was not persisted');

    const version = Number(row.version);
    await insertAudit(ctx.q, ctx.spaceId, ctx.auth.actor, 'offers.published', String(row.offer_id), {
      leadId,
      version,
      currency: offer.currency,
      priceMinor: offer.priceMinor,
    });

    return {
      published: true,
      offerId: String(row.offer_id),
      version,
      country: offer.country,
      currency: offer.currency,
      priceMinor: offer.priceMinor,
      period: offer.period,
      // Absent rather than null: the output validator rejects a null where a
      // number is declared, so an unset field is simply not sent.
      supersedes: version > 1 ? version - 1 : undefined,
      status: 'published',
    };
  });

  return pending(outcome) ? { ...SCHEMA_PENDING, published: false } : outcome;
};

/**
 * deals.decide — record where a deal has got to.
 *
 * Operator-only. This records a decision a human made; it does not make one.
 * Reaching `offer_review` or `accepted` requires a published offer version,
 * because those states mean a specific offer is in front of the owner — and
 * accepting nothing in particular is the hidden-terms failure the MVP excludes.
 */
export const dealsDecide: CapabilityHandler = async (ctx, input) => {
  const leadId = text(input.leadId);
  const to = text(input.state);
  if (leadId === null) throw new CapabilityError(400, 'deals.decide: leadId is required');
  if (to === null) throw new CapabilityError(400, 'deals.decide: state is required');
  if (ctx.spaceId === null) {
    throw new CapabilityError(400, 'deals.decide requires a space (x-atlas-space)');
  }
  const notes = text(input.notes);

  const lead = await ctx.q.query(`select lead_id from leads where lead_id = $1`, [leadId]);
  if (!lead.rows[0]) throw new CapabilityError(404, 'deals.decide: lead not found');

  const outcome = await withSchema(async () => {
    const standing = await ctx.q.query(
      `select state from deal_decisions where lead_id = $1 order by created_at desc limit 1`,
      [leadId],
    );
    // A deal nobody has recorded yet starts as interested.
    const from = standing.rows[0] ? String(standing.rows[0].state) : 'interested';

    /*
     * The offer is resolved from the table rather than taken from the request:
     * a caller naming a version that was never published would otherwise be
     * recorded as an acceptance of it.
     */
    const wanted = typeof input.offerVersion === 'number' ? input.offerVersion : null;
    const offerRow = await ctx.q.query(
      wanted === null
        ? `select offer_id, version from offers where lead_id = $1 order by version desc limit 1`
        : `select offer_id, version from offers where lead_id = $1 and version = $2`,
      wanted === null ? [leadId] : [leadId, wanted],
    );
    const offer = offerRow.rows[0] ?? null;
    const offerVersion = offer ? Number(offer.version) : null;

    const plan = planDealTransition({ from, to, offerVersion });
    if (!plan.ok) {
      await insertAudit(ctx.q, ctx.spaceId, ctx.auth.actor, 'deals.decide_refused', leadId, {
        code: plan.code,
        from,
        to,
      });
      return { decided: false, code: plan.code, note: plan.message, from, status: 'refused' };
    }

    const res = await ctx.q.query(
      `insert into deal_decisions (space_id, lead_id, state, offer_id, offer_version, notes, decided_by)
       values ($1, $2, $3, $4, $5, $6, $7)
       returning decision_id`,
      [ctx.spaceId, leadId, plan.to, offer?.offer_id ?? null, offerVersion, notes, ctx.auth.actor],
    );

    await insertAudit(ctx.q, ctx.spaceId, ctx.auth.actor, 'deals.decided', leadId, {
      from: plan.from,
      to: plan.to,
      offerVersion,
    });

    return {
      decided: true,
      decisionId: String(res.rows[0]?.decision_id ?? ''),
      from: plan.from,
      to: plan.to,
      offerVersion,
      status: plan.to,
    };
  });

  return pending(outcome) ? { ...SCHEMA_PENDING, decided: false } : outcome;
};

/**
 * hosting.state — the offer, the decision and the entitlement for one lead.
 *
 * Read-only. `entitled` is derived from the state rather than stored, so it
 * cannot disagree with the row it describes.
 */
export const hostingState: CapabilityHandler = async (ctx, input) => {
  const leadId = text(input.leadId);
  if (leadId === null) throw new CapabilityError(400, 'hosting.state: leadId is required');

  const outcome = await withSchema(async () => {
    const offer = await ctx.q.query(
      `select offer_id, version, country, currency, price_minor, period, terms_version
         from offers where lead_id = $1 order by version desc limit 1`,
      [leadId],
    );
    const decision = await ctx.q.query(
      `select state, offer_version, created_at from deal_decisions
        where lead_id = $1 order by created_at desc limit 1`,
      [leadId],
    );
    const entitlement = await ctx.q.query(
      `select entitlement_id, state, offer_version, renewal_enabled, payment_reference is not null as paid,
              activated_at, cancelled_at, serves_until
         from hosting_entitlements where lead_id = $1 order by created_at desc limit 1`,
      [leadId],
    );

    const e = entitlement.rows[0];
    const o = offer.rows[0];
    const d = decision.rows[0];
    const state = e ? String(e.state) : null;

    /*
     * Absent sections are omitted rather than null. The output validator
     * rejects a null where an object is declared, so "there is no offer yet"
     * is expressed by the key not being there.
     */
    return {
      offer: !o
        ? undefined
        : {
            offerId: String(o.offer_id),
            version: Number(o.version),
            country: String(o.country),
            currency: String(o.currency),
            priceMinor: Number(o.price_minor),
            period: String(o.period),
            termsVersion: String(o.terms_version),
          },
      deal: !d
        ? undefined
        : {
            state: String(d.state),
            offerVersion: d.offer_version === null ? null : Number(d.offer_version),
          },
      entitlement: !e
        ? undefined
        : {
            entitlementId: String(e.entitlement_id),
            state,
            offerVersion: Number(e.offer_version),
            // Never the reference itself, only whether one exists.
            paymentRecorded: e.paid === true,
            renewalEnabled: e.renewal_enabled === true,
            entitled: state !== null && isHostingState(state) ? isEntitled(state) : false,
            activatedAt: e.activated_at ? new Date(String(e.activated_at)).toISOString() : null,
            cancelledAt: e.cancelled_at ? new Date(String(e.cancelled_at)).toISOString() : null,
            servesUntil: e.serves_until ? new Date(String(e.serves_until)).toISOString() : null,
          },
      status: 'ok',
    };
  });

  return pending(outcome) ? { ...SCHEMA_PENDING } : outcome;
};
