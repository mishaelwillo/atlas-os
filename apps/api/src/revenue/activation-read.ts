/**
 * The facts the hosting activation gate decides on
 * (docs/specs/p2/revenue-pilot.md).
 *
 * Read in one place because two callers need exactly the same view: the
 * pre-approval gate, so an activation that cannot pass never reaches the
 * queue, and the dispatcher, so an approval recorded earlier cannot activate
 * something that changed since. If they read different things they could
 * disagree, and the queue would become where the decision is really made.
 */
import type { Queryable } from '../db.js';
import { REQUIRED_DISCLOSURES } from './offers.js';

export interface ActivationFacts {
  entitlementId: string;
  state: string;
  entitlementOfferVersion: number | null;
  paymentReference: string | null;
  dealState: string | null;
  acceptedOfferVersion: number | null;
  disclosuresComplete: boolean;
}

export interface ActivationUnreadable {
  note: string;
}

/**
 * Gather the entitlement, the standing deal decision, and whether the offer
 * that decision was made on carried every required disclosure.
 *
 * Disclosure completeness is recomputed from the stored offer rather than
 * trusted from a flag: the offer row keeps what was actually shown to the
 * owner, and that is the only thing worth checking against.
 */
export async function readActivationFacts(
  q: Queryable,
  leadId: string,
): Promise<ActivationFacts | ActivationUnreadable> {
  const entitlement = await q.query(
    `select entitlement_id, state, offer_version, payment_reference
       from hosting_entitlements
      where lead_id = $1 and state <> 'cancelled'
      order by created_at desc limit 1`,
    [leadId],
  );
  const e = entitlement.rows[0];
  if (!e) return { note: 'no hosting entitlement for this lead' };

  const decision = await q.query(
    `select state, offer_version from deal_decisions
      where lead_id = $1 order by created_at desc limit 1`,
    [leadId],
  );
  const d = decision.rows[0];
  const dealState = d ? String(d.state) : null;
  const acceptedOfferVersion =
    d && d.offer_version !== null && dealState === 'accepted' ? Number(d.offer_version) : null;

  let disclosuresComplete = false;
  if (acceptedOfferVersion !== null) {
    const offer = await q.query(
      `select disclosures from offers where lead_id = $1 and version = $2`,
      [leadId, acceptedOfferVersion],
    );
    const stored = (offer.rows[0]?.disclosures ?? {}) as Record<string, unknown>;
    disclosuresComplete = REQUIRED_DISCLOSURES.every((key) => {
      const value = stored[key];
      return typeof value === 'string' && value.trim() !== '';
    });
  }

  return {
    entitlementId: String(e.entitlement_id),
    state: String(e.state),
    entitlementOfferVersion: e.offer_version === null ? null : Number(e.offer_version),
    paymentReference: e.payment_reference === null ? null : String(e.payment_reference),
    dealState,
    acceptedOfferVersion,
    disclosuresComplete,
  };
}
