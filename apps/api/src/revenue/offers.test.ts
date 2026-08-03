/**
 * Offers, terms and the hosting activation gate
 * (docs/specs/p2/revenue-pilot.md).
 *
 * Acceptance: "Hosting cannot activate before approved terms and confirmed
 * payment; cancellation disables renewal while preserving export/history."
 */
import { describe, expect, it } from 'vitest';
import {
  OFFER_PERIODS,
  REQUIRED_DISCLOSURES,
  planDealTransition,
  validateOffer,
  type OfferDraft,
} from './offers.js';
import {
  ENTITLED_STATES,
  HOSTING_STATES,
  isEntitled,
  planCancellation,
  planHostingTransition,
  type ActivationInput,
} from './hosting-activation.js';

function disclosures(omit?: string): Record<string, string> {
  return Object.fromEntries(
    REQUIRED_DISCLOSURES.filter((k) => k !== omit).map((k) => [k, `plain-language ${k}`]),
  );
}

function draft(overrides: Partial<OfferDraft> = {}): OfferDraft {
  return {
    country: 'US',
    currency: 'USD',
    priceMinor: 4900,
    period: 'monthly',
    disclosures: disclosures(),
    termsVersion: 'terms-2026-08',
    ...overrides,
  };
}

describe('publishing an offer', () => {
  it('accepts a complete offer and normalises its codes', () => {
    const offer = validateOffer(draft({ country: 'us', currency: 'usd' }));
    expect(offer).toMatchObject({ ok: true, country: 'US', currency: 'USD', priceMinor: 4900 });
  });

  /** "No silent USD assumption" is a requirement, not a preference. */
  it('refuses an offer with no currency', () => {
    expect(validateOffer(draft({ currency: '' }))).toMatchObject({
      ok: false,
      code: 'currency_missing',
    });
  });

  it('refuses a currency that is not an ISO code', () => {
    expect(validateOffer(draft({ currency: 'dollars' }))).toMatchObject({
      ok: false,
      code: 'currency_missing',
    });
  });

  /** Terms are versioned per country, so the country is not optional. */
  it('refuses an offer with no country', () => {
    expect(validateOffer(draft({ country: '' }))).toMatchObject({
      ok: false,
      code: 'country_missing',
    });
  });

  /**
   * The presenter's figures are unvalidated research, so there is no default
   * price to fall back on. A missing price must not resolve to one.
   */
  it('refuses an offer with no price', () => {
    expect(validateOffer(draft({ priceMinor: Number.NaN }))).toMatchObject({
      ok: false,
      code: 'price_missing',
    });
    expect(validateOffer(draft({ priceMinor: -100 }))).toMatchObject({
      ok: false,
      code: 'price_missing',
    });
  });

  /** The pitch is a free site with hosting-only payment; zero is a real price. */
  it('accepts a zero price, which is different from an absent one', () => {
    expect(validateOffer(draft({ priceMinor: 0 }))).toMatchObject({ ok: true, priceMinor: 0 });
  });

  it('refuses a billing period it does not know', () => {
    expect(validateOffer(draft({ period: 'weekly' }))).toMatchObject({
      ok: false,
      code: 'period_unknown',
    });
    expect(OFFER_PERIODS).toContain('monthly');
  });

  it('refuses an offer that names no terms version', () => {
    expect(validateOffer(draft({ termsVersion: '  ' }))).toMatchObject({
      ok: false,
      code: 'terms_version_missing',
    });
  });

  /** Every disclosure the specification names must be present before activation. */
  it('refuses an offer missing any required disclosure, and says which', () => {
    for (const key of REQUIRED_DISCLOSURES) {
      const refusal = validateOffer(draft({ disclosures: disclosures(key) }));
      expect(refusal).toMatchObject({ ok: false, code: 'disclosures_incomplete' });
      if (refusal.ok) throw new Error('expected refusal');
      expect(refusal.missing).toEqual([key]);
    }
  });

  it('treats a blank disclosure as missing', () => {
    const refusal = validateOffer(draft({ disclosures: { ...disclosures(), renewal: '   ' } }));
    expect(refusal).toMatchObject({ ok: false, code: 'disclosures_incomplete' });
  });
});

describe('deal decisions', () => {
  it('walks the states the specification lists', () => {
    expect(planDealTransition({ from: 'interested', to: 'discovery', offerVersion: null })).toMatchObject({
      ok: true,
    });
    expect(planDealTransition({ from: 'discovery', to: 'offer_review', offerVersion: 1 })).toMatchObject({
      ok: true,
    });
    expect(planDealTransition({ from: 'offer_review', to: 'accepted', offerVersion: 1 })).toMatchObject({
      ok: true,
    });
  });

  it('allows declining from any open state', () => {
    for (const from of ['interested', 'discovery', 'offer_review']) {
      expect(planDealTransition({ from, to: 'declined', offerVersion: 1 })).toMatchObject({ ok: true });
    }
  });

  /** Accepting nothing in particular is the hidden-terms failure. */
  it('refuses to review or accept without a published offer version', () => {
    expect(planDealTransition({ from: 'discovery', to: 'offer_review', offerVersion: null })).toMatchObject(
      { ok: false, code: 'offer_required' },
    );
    expect(planDealTransition({ from: 'offer_review', to: 'accepted', offerVersion: null })).toMatchObject(
      { ok: false, code: 'offer_required' },
    );
  });

  it('refuses to skip discovery straight to acceptance', () => {
    expect(planDealTransition({ from: 'interested', to: 'accepted', offerVersion: 1 })).toMatchObject({
      ok: false,
      code: 'not_a_permitted_transition',
    });
  });

  it('refuses to move a decided deal', () => {
    for (const from of ['accepted', 'declined']) {
      expect(planDealTransition({ from, to: 'discovery', offerVersion: 1 })).toMatchObject({
        ok: false,
        code: 'terminal_state',
      });
    }
  });
});

describe('the hosting activation gate', () => {
  const ready: ActivationInput = {
    from: 'payment_pending',
    to: 'entitlement_active',
    dealState: 'accepted',
    acceptedOfferVersion: 2,
    entitlementOfferVersion: 2,
    disclosuresComplete: true,
    paymentReference: 'prov_ref_123',
  };

  it('activates when terms are accepted and payment is recorded', () => {
    expect(planHostingTransition(ready)).toMatchObject({
      ok: true,
      to: 'entitlement_active',
      grantsEntitlement: true,
    });
  });

  it('refuses when no deal decision exists', () => {
    expect(planHostingTransition({ ...ready, dealState: null })).toMatchObject({
      ok: false,
      code: 'terms_not_accepted',
    });
  });

  it('refuses when the deal was declined or is still open', () => {
    for (const dealState of ['declined', 'offer_review', 'discovery']) {
      expect(planHostingTransition({ ...ready, dealState })).toMatchObject({
        ok: false,
        code: 'terms_not_accepted',
      });
    }
  });

  /**
   * A customer who accepted one offer must not be activated onto another. An
   * offer revised after acceptance is a new offer needing a new decision.
   */
  it('refuses when the accepted offer is not the one being activated', () => {
    const refusal = planHostingTransition({ ...ready, acceptedOfferVersion: 1 });
    expect(refusal).toMatchObject({ ok: false, code: 'offer_version_mismatch' });
    if (refusal.ok) throw new Error('expected refusal');
    expect(refusal.message).toContain('1');
    expect(refusal.message).toContain('2');
  });

  it('refuses when the accepted offer was missing a disclosure', () => {
    expect(planHostingTransition({ ...ready, disclosuresComplete: false })).toMatchObject({
      ok: false,
      code: 'disclosures_incomplete',
    });
  });

  /** Atlas never confirms a payment; it records the provider's reference. */
  it('refuses when no payment reference is recorded', () => {
    expect(planHostingTransition({ ...ready, paymentReference: null })).toMatchObject({
      ok: false,
      code: 'payment_not_confirmed',
    });
    expect(planHostingTransition({ ...ready, paymentReference: '   ' })).toMatchObject({
      ok: false,
      code: 'payment_not_confirmed',
    });
  });

  /** The gate guards one door; the rest of the chain is not a back way in. */
  it('cannot be reached by skipping to a later state', () => {
    expect(
      planHostingTransition({ ...ready, from: 'terms_approved', to: 'entitlement_active' }),
    ).toMatchObject({ ok: false, code: 'not_a_permitted_transition' });
    expect(planHostingTransition({ ...ready, from: 'terms_approved', to: 'active' })).toMatchObject({
      ok: false,
      code: 'not_a_permitted_transition',
    });
  });

  it('lets a served customer lapse and recover', () => {
    expect(
      planHostingTransition({ ...ready, from: 'active', to: 'past_due' }),
    ).toMatchObject({ ok: true });
    expect(
      planHostingTransition({ ...ready, from: 'past_due', to: 'active' }),
    ).toMatchObject({ ok: true });
  });

  it('refuses to revive a cancelled entitlement', () => {
    expect(planHostingTransition({ ...ready, from: 'cancelled', to: 'active' })).toMatchObject({
      ok: false,
      code: 'cancelled',
    });
  });

  it('knows which states entitle a customer to hosting', () => {
    expect(isEntitled('payment_pending')).toBe(false);
    expect(isEntitled('entitlement_active')).toBe(true);
    expect(isEntitled('cancelled')).toBe(false);
    expect(ENTITLED_STATES.every((s) => HOSTING_STATES.includes(s))).toBe(true);
  });
});

describe('cancellation', () => {
  it('disables renewal', () => {
    expect(planCancellation('active')).toMatchObject({
      ok: true,
      to: 'cancelled',
      renewalDisabled: true,
    });
  });

  /** Cancelling is not a refund; a paid-for site keeps serving its period. */
  it('keeps serving an entitled customer until the period ends', () => {
    expect(planCancellation('active')).toMatchObject({ servesUntilPeriodEnd: true });
    expect(planCancellation('onboarded')).toMatchObject({ servesUntilPeriodEnd: true });
  });

  it('has nothing to keep serving before activation', () => {
    expect(planCancellation('payment_pending')).toMatchObject({ servesUntilPeriodEnd: false });
  });

  it('can be reached from any live state', () => {
    for (const from of HOSTING_STATES.filter((s) => s !== 'cancelled')) {
      expect(planCancellation(from)).toMatchObject({ ok: true });
    }
  });

  it('refuses to cancel twice', () => {
    expect(planCancellation('cancelled')).toMatchObject({ ok: false, code: 'already_cancelled' });
  });
});
