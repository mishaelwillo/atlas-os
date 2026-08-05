/**
 * Offers, terms and the hosting activation gate
 * (docs/specs/p2/revenue-pilot.md).
 *
 * Acceptance: "Hosting cannot activate before approved terms and confirmed
 * payment; cancellation disables renewal while preserving export/history."
 *
 * Two things this module refuses to do, both deliberate:
 *
 * It has no default price and no default currency. The presenter's figures —
 * 100/119 monthly hosting, 2,000 for a website, 50/100 hourly, and the
 * caption-rendered 9.97 — are recorded in the research ledger as unvalidated
 * observation, not Atlas price policy. A default here would quietly turn one
 * of them into policy, and "no silent USD assumption" is a specification
 * requirement rather than a preference.
 *
 * It never confirms a payment. `billing.manage` is P3 and deferred until after
 * pilot approval, so no provider is integrated; a confirmed payment is a fact
 * an operator records with the provider's own reference. Nothing here may
 * charge anyone, and no card data is accepted or stored.
 *
 * Pure and deterministic — no clock, no database, no network.
 */

/**
 * What must be disclosed before hosting activates.
 *
 * The specification lists these by name. They are a checklist rather than
 * prose because an offer missing one of them is refused, and a refusal has to
 * be able to say which.
 */
export const REQUIRED_DISCLOSURES = [
  'site_ownership',
  'domain_ownership',
  'hosting_scope',
  'security_scope',
  'support_boundary',
  'edit_boundary',
  'data_portability',
  'renewal',
  'taxes',
  'cancellation_refund',
  'suspension',
  'migration',
] as const;

export type Disclosure = (typeof REQUIRED_DISCLOSURES)[number];

/** ISO-4217 is three uppercase letters. Anything else is not a currency. */
const CURRENCY = /^[A-Z]{3}$/;
/** ISO-3166-1 alpha-2. */
const COUNTRY = /^[A-Z]{2}$/;

export interface OfferDraft {
  /** Country the offer is made in; terms are versioned per country. */
  country: string;
  /** Currency the price is stated in. Required — there is no default. */
  currency: string;
  /** Recurring hosting price in minor units. Required — there is no default. */
  priceMinor: number;
  /** Billing period the price covers. */
  period: string;
  /** Disclosure key → the text shown to the owner. */
  disclosures: Readonly<Record<string, string>>;
  /** Identifier of the terms document this offer is bound to. */
  termsVersion: string;
}

export type OfferRefusalCode =
  | 'country_missing'
  | 'currency_missing'
  | 'price_missing'
  | 'period_unknown'
  | 'terms_version_missing'
  | 'disclosures_incomplete';

export interface OfferRefusal {
  ok: false;
  code: OfferRefusalCode;
  message: string;
  /** Disclosure keys that are absent or empty. */
  missing?: string[];
}

export interface ValidatedOffer {
  ok: true;
  country: string;
  currency: string;
  priceMinor: number;
  period: OfferPeriod;
  termsVersion: string;
  disclosures: Record<Disclosure, string>;
}

export const OFFER_PERIODS = ['monthly', 'yearly'] as const;
export type OfferPeriod = (typeof OFFER_PERIODS)[number];

/**
 * Validate an offer before it can be shown to a business owner.
 *
 * A price of zero is allowed: the presenter's pitch is a free site with
 * hosting-only payment, and Atlas tests that as one transparent offer version.
 * A *missing* price is not allowed, because "free" and "nobody said" must not
 * look the same to the person accepting it.
 */
export function validateOffer(draft: OfferDraft): ValidatedOffer | OfferRefusal {
  const country = draft.country.trim().toUpperCase();
  const currency = draft.currency.trim().toUpperCase();

  if (!COUNTRY.test(country)) {
    return {
      ok: false,
      code: 'country_missing',
      message: 'an offer needs the ISO-3166 country it is made in; terms are versioned per country',
    };
  }
  if (!CURRENCY.test(currency)) {
    return {
      ok: false,
      code: 'currency_missing',
      message: 'an offer needs an explicit ISO-4217 currency; there is no default and no USD assumption',
    };
  }
  if (!Number.isInteger(draft.priceMinor) || draft.priceMinor < 0) {
    return {
      ok: false,
      code: 'price_missing',
      message: 'an offer needs an explicit price in minor units; zero is permitted, absent is not',
    };
  }
  if (!(OFFER_PERIODS as readonly string[]).includes(draft.period)) {
    return {
      ok: false,
      code: 'period_unknown',
      message: `billing period must be one of ${OFFER_PERIODS.join(', ')}`,
    };
  }
  if (draft.termsVersion.trim() === '') {
    return {
      ok: false,
      code: 'terms_version_missing',
      message: 'an offer must name the terms version it binds',
    };
  }

  const missing = REQUIRED_DISCLOSURES.filter((key) => {
    const value = draft.disclosures[key];
    return typeof value !== 'string' || value.trim() === '';
  });
  if (missing.length > 0) {
    return {
      ok: false,
      code: 'disclosures_incomplete',
      message: `these must be disclosed before hosting can activate: ${missing.join(', ')}`,
      missing: [...missing],
    };
  }

  const disclosures = Object.fromEntries(
    REQUIRED_DISCLOSURES.map((key) => [key, draft.disclosures[key].trim()]),
  ) as Record<Disclosure, string>;

  return {
    ok: true,
    country,
    currency,
    priceMinor: draft.priceMinor,
    period: draft.period as OfferPeriod,
    termsVersion: draft.termsVersion.trim(),
    disclosures,
  };
}

// ---------- deal decisions ----------

export const DEAL_STATES = ['interested', 'discovery', 'offer_review', 'accepted', 'declined'] as const;

export type DealState = (typeof DEAL_STATES)[number];

const NEXT_DEAL_STATES: Readonly<Record<DealState, readonly DealState[]>> = {
  interested: ['discovery', 'declined'],
  discovery: ['offer_review', 'declined'],
  offer_review: ['accepted', 'declined'],
  accepted: [],
  declined: [],
};

export type DealRefusalCode = 'unknown_state' | 'terminal_state' | 'not_a_permitted_transition' | 'offer_required';

export interface DealRefusal {
  ok: false;
  code: DealRefusalCode;
  message: string;
}

export interface DealPlan {
  ok: true;
  from: DealState;
  to: DealState;
}

export function isDealState(value: string): value is DealState {
  return (DEAL_STATES as readonly string[]).includes(value);
}

/**
 * Every state this deal may actually be moved to, derived by asking
 * `planDealTransition` rather than by restating the transition table.
 *
 * The demo queue and the outreach touches already publish their permitted
 * moves this way; deals did not, so the operator surface offered all five
 * states and left the API to refuse four of them. Running the pilot through a
 * browser is what made it visible: choosing `offer_review` from `interested`
 * looked like a legitimate option and came back refused.
 *
 * `offerVersion` is part of the question rather than a detail. Reaching
 * `offer_review` or `accepted` names a specific published offer, so with none
 * published the derivation correctly offers neither.
 */
export function permittedDealMoves(args: {
  from: string;
  offerVersion: number | null;
}): DealState[] {
  return DEAL_STATES.filter(
    (to) => planDealTransition({ from: args.from, to, offerVersion: args.offerVersion }).ok,
  );
}

/**
 * Decide whether a deal may move.
 *
 * Reaching `offer_review` requires a published offer version, because that
 * state means a specific offer is in front of the owner. Accepting without one
 * would record an acceptance of nothing in particular, which is precisely the
 * hidden-terms failure the MVP excludes.
 */
export function planDealTransition(args: {
  from: string;
  to: string;
  offerVersion: number | null;
}): DealPlan | DealRefusal {
  if (!isDealState(args.from) || !isDealState(args.to)) {
    return {
      ok: false,
      code: 'unknown_state',
      message: `'${args.from}' → '${args.to}' is not a known deal transition`,
    };
  }
  if (NEXT_DEAL_STATES[args.from].length === 0) {
    return {
      ok: false,
      code: 'terminal_state',
      message: `a '${args.from}' deal is decided and cannot move again`,
    };
  }
  if (!NEXT_DEAL_STATES[args.from].includes(args.to)) {
    return {
      ok: false,
      code: 'not_a_permitted_transition',
      message: `a '${args.from}' deal may only become ${NEXT_DEAL_STATES[args.from].join(' or ')}`,
    };
  }
  if ((args.to === 'offer_review' || args.to === 'accepted') && args.offerVersion === null) {
    return {
      ok: false,
      code: 'offer_required',
      message: `'${args.to}' names a specific published offer version; there is none`,
    };
  }
  return { ok: true, from: args.from, to: args.to };
}
