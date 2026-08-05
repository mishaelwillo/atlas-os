/**
 * Hosting entitlement state (docs/specs/p2/revenue-pilot.md).
 *
 * Acceptance: "Hosting cannot activate before approved terms and confirmed
 * payment; cancellation disables renewal while preserving export/history."
 *
 * The state chain is `terms_approved → payment_pending → entitlement_active →
 * onboarded → active → past_due|cancelled`, and the gate that matters sits at
 * the entrance to `entitlement_active`. Everything before it is preparation;
 * everything after it is a customer being served.
 *
 * Which of those states the *product* can reach is a separate question from
 * which the table permits, and it is answered by `reachableHostingStates`
 * below rather than by this comment. `past_due` is deliberately out of reach —
 * see `DEFERRED_HOSTING_STATES` for why.
 *
 * A payment is never confirmed here. `billing.manage` is deferred to P3, so no
 * provider is integrated: a confirmed payment is a fact an operator records
 * with the provider's own reference, and that reference is all Atlas keeps. No
 * card data is accepted, and none is stored.
 *
 * Pure and deterministic — no clock, no database, no network.
 */

import { REQUIRED_DISCLOSURES } from './offers.js';

/** How many disclosures an offer must carry; named so a refusal can say it. */
const REQUIRED_DISCLOSURE_COUNT = REQUIRED_DISCLOSURES.length;

export const HOSTING_STATES = [
  'terms_approved',
  'payment_pending',
  'entitlement_active',
  'onboarded',
  'active',
  'past_due',
  'cancelled',
] as const;

export type HostingState = (typeof HOSTING_STATES)[number];

const NEXT_HOSTING_STATES: Readonly<Record<HostingState, readonly HostingState[]>> = {
  terms_approved: ['payment_pending', 'cancelled'],
  payment_pending: ['entitlement_active', 'cancelled'],
  entitlement_active: ['onboarded', 'cancelled'],
  onboarded: ['active', 'cancelled'],
  // A served customer can lapse and recover, or leave.
  active: ['past_due', 'cancelled'],
  past_due: ['active', 'cancelled'],
  cancelled: [],
};

/** States in which the customer is entitled to hosting. */
export const ENTITLED_STATES: readonly HostingState[] = [
  'entitlement_active',
  'onboarded',
  'active',
  'past_due',
];

export function isHostingState(value: string): value is HostingState {
  return (HOSTING_STATES as readonly string[]).includes(value);
}

/**
 * Which states a capability can actually put an entitlement into.
 *
 * `NEXT_HOSTING_STATES` says what the state machine permits. That is a
 * different question from what the product can do, and the two had drifted
 * apart: the table declared `entitlement_active → onboarded → active` while
 * `hosting.activate` hardcoded `entitlement_active` as its only target and
 * nothing else moved an entitlement forward. Three of the seven states could
 * not be reached by any caller, and this file's own header described the whole
 * chain as though it were traversable — one more claim nothing checked.
 *
 * The capabilities import these rather than restating a target inline, so the
 * closure below is computed from what the code actually requests.
 */
export const TERMS_ENTRY_STATES = ['terms_approved', 'payment_pending'] as const;
export const ACTIVATION_TARGET_STATE = 'entitlement_active' as const;
export const ADVANCE_TARGET_STATES = ['onboarded', 'active'] as const;
export const CANCELLATION_TARGET_STATE = 'cancelled' as const;

export type AdvanceTargetState = (typeof ADVANCE_TARGET_STATES)[number];

export function isAdvanceTarget(value: string): value is AdvanceTargetState {
  return (ADVANCE_TARGET_STATES as readonly string[]).includes(value);
}

/**
 * States no capability can reach, each with the reason it cannot.
 *
 * A state that is unreachable *and* undeclared is the defect. A state that is
 * unreachable because the thing that would reach it is deferred is a decision,
 * and saying so here is what keeps the two apart — the reachability test
 * refuses any state that is neither.
 */
export const DEFERRED_HOSTING_STATES: Readonly<Partial<Record<HostingState, string>>> = {
  past_due:
    'a lapse is a payment fact, and Atlas confirms no payments: billing.manage is deferred to P3, so nothing can observe one. Reaching past_due by hand would record a lapse nobody detected.',
};

/**
 * Every state an entitlement can actually arrive in, walked from the states
 * `hosting.record_terms` creates through the targets the other capabilities
 * may request. Both halves of each step are real: the transition table has to
 * permit it and some capability has to ask for it.
 */
export function reachableHostingStates(): Set<HostingState> {
  const targets: readonly HostingState[] = [
    ACTIVATION_TARGET_STATE,
    ...ADVANCE_TARGET_STATES,
    CANCELLATION_TARGET_STATE,
  ];
  const reached = new Set<HostingState>(TERMS_ENTRY_STATES);
  for (;;) {
    const before = reached.size;
    for (const from of [...reached]) {
      for (const to of targets) {
        if (NEXT_HOSTING_STATES[from].includes(to)) reached.add(to);
      }
    }
    if (reached.size === before) return reached;
  }
}

export function isEntitled(state: HostingState): boolean {
  return ENTITLED_STATES.includes(state);
}

/**
 * A payment reference is a pointer at the provider's own record. It is never
 * card data, and this is the one place that could accidentally become card
 * data — an operator copying the wrong field. Thirteen to nineteen digits,
 * ignoring spaces and dashes, is a card number shape; refusing it costs an
 * operator nothing and stops the one input Atlas must never hold.
 */
const CARD_SHAPED = /^[0-9][0-9 -]{11,25}$/;

export function looksLikeCardNumber(reference: string): boolean {
  const trimmed = reference.trim();
  if (!CARD_SHAPED.test(trimmed)) return false;
  const digits = trimmed.replace(/[ -]/g, '');
  return digits.length >= 13 && digits.length <= 19;
}

export type TermsRefusalCode =
  | 'terms_not_accepted'
  | 'offer_version_mismatch'
  | 'disclosures_incomplete'
  | 'already_recorded'
  | 'payment_reference_looks_like_card_data';

export interface TermsRefusal {
  ok: false;
  code: TermsRefusalCode;
  message: string;
}

export interface TermsPlan {
  ok: true;
  /** The offer version the entitlement is bound to. */
  offerVersion: number;
  /**
   * `terms_approved` when only the decision is recorded, `payment_pending`
   * when the operator already holds the provider's reference. Both are
   * preparation; neither entitles anyone to anything.
   */
  state: Extract<HostingState, 'terms_approved' | 'payment_pending'>;
  paymentReference: string | null;
}

export interface TermsInput {
  /** The standing deal decision for this customer. */
  dealState: string | null;
  /** Offer version the deal was accepted against. */
  acceptedOfferVersion: number | null;
  /** Whether that offer version carried every required disclosure. */
  disclosuresComplete: boolean;
  /** State of an existing non-cancelled entitlement, if there is one. */
  existingState: string | null;
  /** Provider reference an operator read off the provider's console. */
  paymentReference: string | null;
}

/**
 * Decide whether accepted terms may be recorded as a hosting entitlement.
 *
 * This is the entrance the chain was missing. `hosting.activate` moves an
 * entitlement to `entitlement_active`, `hosting.cancel` ends one and
 * `hosting.state` reads one — but nothing created one, so the acceptance
 * "one paying customer" was unreachable through the product no matter what an
 * operator did. Found by approving a real activation and reading the refusal:
 * "no hosting entitlement for this lead".
 *
 * It checks the same three commercial facts the activation gate checks, and
 * for the same reason: an entitlement recorded against terms nobody accepted,
 * or against a different offer version than the one accepted, would put a
 * customer one approval away from being served something they never agreed to.
 *
 * It does not confirm a payment and cannot. Supplying a reference records that
 * an operator saw one in the provider's console; it moves the entitlement to
 * `payment_pending`, which still entitles nobody to anything.
 */
export function planRecordTerms(input: TermsInput): TermsPlan | TermsRefusal {
  if (input.existingState !== null) {
    return {
      ok: false,
      code: 'already_recorded',
      message: `this customer already has a '${input.existingState}' entitlement; cancel it before recording new terms`,
    };
  }
  if (input.dealState !== 'accepted') {
    return {
      ok: false,
      code: 'terms_not_accepted',
      message:
        input.dealState === null
          ? 'no deal decision is recorded for this customer'
          : `the deal is '${input.dealState}'; terms can only be recorded once it is accepted`,
    };
  }
  if (input.acceptedOfferVersion === null) {
    return {
      ok: false,
      code: 'offer_version_mismatch',
      message: 'the accepted deal names no offer version, so there is nothing to bind terms to',
    };
  }
  if (!input.disclosuresComplete) {
    return {
      ok: false,
      code: 'disclosures_incomplete',
      message: `the accepted offer version is missing required disclosures; every one of the ${REQUIRED_DISCLOSURE_COUNT} must carry text before hosting can be prepared`,
    };
  }

  const reference = input.paymentReference === null ? null : input.paymentReference.trim();
  if (reference !== null && reference !== '' && looksLikeCardNumber(reference)) {
    return {
      ok: false,
      code: 'payment_reference_looks_like_card_data',
      message:
        'that looks like a card number; record the provider’s own reference for the payment, never the instrument',
    };
  }

  const recorded = reference === null || reference === '' ? null : reference;
  return {
    ok: true,
    offerVersion: input.acceptedOfferVersion,
    state: recorded === null ? 'terms_approved' : 'payment_pending',
    paymentReference: recorded,
  };
}

export type ActivationRefusalCode =
  | 'unknown_state'
  | 'cancelled'
  | 'not_a_permitted_transition'
  | 'terms_not_accepted'
  | 'offer_version_mismatch'
  | 'disclosures_incomplete'
  | 'payment_not_confirmed';

export interface ActivationRefusal {
  ok: false;
  code: ActivationRefusalCode;
  message: string;
}

export interface ActivationPlan {
  ok: true;
  from: HostingState;
  to: HostingState;
  /** True when this move first grants the customer hosting. */
  grantsEntitlement: boolean;
}

export interface ActivationInput {
  from: string;
  to: string;
  /** The deal decision recorded for this customer. */
  dealState: string | null;
  /** Offer version the deal was accepted against. */
  acceptedOfferVersion: number | null;
  /** Offer version this entitlement is being activated for. */
  entitlementOfferVersion: number | null;
  /** Whether that offer version carried every required disclosure. */
  disclosuresComplete: boolean;
  /**
   * Payment-provider reference an operator recorded. Atlas never confirms a
   * payment itself and stores no card data — only this reference.
   */
  paymentReference: string | null;
}

/**
 * Decide whether a hosting entitlement may move.
 *
 * The acceptance test lives in one branch: `payment_pending →
 * entitlement_active` requires an accepted deal, on the *same* offer version
 * this entitlement is for, whose disclosures were complete, plus a recorded
 * payment reference. Any one of those missing refuses, and says which.
 *
 * The offer-version check is not pedantry. A customer who accepted last
 * quarter's price must not be activated onto this quarter's, and an offer
 * revised after acceptance is a new offer that needs a new decision.
 */
export function planHostingTransition(input: ActivationInput): ActivationPlan | ActivationRefusal {
  if (!isHostingState(input.from) || !isHostingState(input.to)) {
    return {
      ok: false,
      code: 'unknown_state',
      message: `'${input.from}' → '${input.to}' is not a known hosting transition`,
    };
  }
  if (input.from === 'cancelled') {
    return {
      ok: false,
      code: 'cancelled',
      message: 'a cancelled entitlement cannot be revived; record a new one',
    };
  }
  if (!NEXT_HOSTING_STATES[input.from].includes(input.to)) {
    return {
      ok: false,
      code: 'not_a_permitted_transition',
      message: `a '${input.from}' entitlement may only become ${NEXT_HOSTING_STATES[input.from].join(' or ')}`,
    };
  }

  if (input.to === 'entitlement_active') {
    if (input.dealState !== 'accepted') {
      return {
        ok: false,
        code: 'terms_not_accepted',
        message:
          input.dealState === null
            ? 'no deal decision is recorded; hosting cannot activate before terms are accepted'
            : `the deal is '${input.dealState}', not accepted`,
      };
    }
    if (
      input.acceptedOfferVersion === null ||
      input.acceptedOfferVersion !== input.entitlementOfferVersion
    ) {
      return {
        ok: false,
        code: 'offer_version_mismatch',
        message: `terms were accepted on offer version ${input.acceptedOfferVersion ?? 'none'}, but this entitlement is for ${input.entitlementOfferVersion ?? 'none'}`,
      };
    }
    if (!input.disclosuresComplete) {
      return {
        ok: false,
        code: 'disclosures_incomplete',
        message: 'the accepted offer does not carry every required disclosure',
      };
    }
    if (input.paymentReference === null || input.paymentReference.trim() === '') {
      return {
        ok: false,
        code: 'payment_not_confirmed',
        message: 'no payment-provider reference is recorded; hosting cannot activate before payment is confirmed',
      };
    }
  }

  return {
    ok: true,
    from: input.from,
    to: input.to,
    grantsEntitlement: !isEntitled(input.from) && isEntitled(input.to),
  };
}

export type AdvanceRefusalCode = ActivationRefusalCode | 'not_an_advance_target';

/**
 * Decide whether a served customer's entitlement may move along the delivery
 * chain — `entitlement_active → onboarded → active`.
 *
 * These moves grant nothing. `isEntitled` is already true at
 * `entitlement_active`, so onboarding and going live record how far delivery
 * has got, not what the customer is owed. That is why this is operator-only
 * rather than approval-gated: an approval exists for an action with an
 * external effect or a commercial consequence, and asking for one to record
 * bookkeeping teaches operators to click through the queue.
 *
 * **The target is restricted, and that restriction is the whole safety
 * property.** `planHostingTransition` will happily permit `payment_pending →
 * entitlement_active` — that is its job — so an advance capability that passed
 * an arbitrary target through to it would be an unapproved route into
 * activation, past both halves of the gate. It refuses any target that is not
 * a delivery state, naming the capability that owns it instead.
 */
export function planAdvanceHosting(
  input: ActivationInput,
): ActivationPlan | (Omit<ActivationRefusal, 'code'> & { code: AdvanceRefusalCode }) {
  if (!isAdvanceTarget(input.to)) {
    const owner =
      input.to === ACTIVATION_TARGET_STATE
        ? 'hosting.activate'
        : input.to === CANCELLATION_TARGET_STATE
          ? 'hosting.cancel'
          : null;
    return {
      ok: false,
      code: 'not_an_advance_target',
      message:
        owner === null
          ? `'${input.to}' is not a delivery state; this capability may only move an entitlement to ${ADVANCE_TARGET_STATES.join(' or ')}`
          : `'${input.to}' is ${owner}'s to make, and it is approval-gated; this capability may only move an entitlement to ${ADVANCE_TARGET_STATES.join(' or ')}`,
    };
  }
  return planHostingTransition(input);
}

/**
 * The delivery moves an entitlement in this state may make, probed from
 * `planAdvanceHosting` rather than restated.
 *
 * The card that renders these must not be able to offer a move the API
 * refuses — that is the mistake the deal control made, offering four
 * transitions the API would not take. `entitlement_active` and `cancelled`
 * are absent from every result by construction, because the planner refuses
 * them and this asks the planner.
 *
 * The commercial facts are supplied as satisfied, since none of them gate a
 * delivery move: the entrance to `entitlement_active` is the only branch that
 * reads them, and no advance target is that state.
 */
export function permittedHostingMoves(from: string): AdvanceTargetState[] {
  return ADVANCE_TARGET_STATES.filter(
    (to) =>
      planAdvanceHosting({
        from,
        to,
        dealState: 'accepted',
        acceptedOfferVersion: 1,
        entitlementOfferVersion: 1,
        disclosuresComplete: true,
        paymentReference: 'probe',
      }).ok,
  );
}

export interface CancellationPlan {
  ok: true;
  from: HostingState;
  to: 'cancelled';
  /** Renewal stops; this is the point of cancelling. */
  renewalDisabled: true;
  /**
   * Whether hosting keeps serving until the paid period ends. Cancelling is
   * not a refund, and taking a paid-for site down early would be worse service
   * than the thing being cancelled.
   */
  servesUntilPeriodEnd: boolean;
}

export interface CancellationRefusal {
  ok: false;
  code: 'unknown_state' | 'already_cancelled';
  message: string;
}

/**
 * Cancel an entitlement.
 *
 * Cancellation disables renewal and nothing else. It deletes no history, no
 * offer, and no export: the specification requires cancellation to preserve
 * both, and the pilot's exit criteria need the record of customers who left as
 * much as the record of those who stayed.
 */
export function planCancellation(from: string): CancellationPlan | CancellationRefusal {
  if (!isHostingState(from)) {
    return { ok: false, code: 'unknown_state', message: `'${from}' is not a known hosting state` };
  }
  if (from === 'cancelled') {
    return { ok: false, code: 'already_cancelled', message: 'this entitlement is already cancelled' };
  }
  return {
    ok: true,
    from,
    to: 'cancelled',
    renewalDisabled: true,
    // A customer who paid for the period keeps it; one who never activated has
    // nothing to keep serving.
    servesUntilPeriodEnd: isEntitled(from),
  };
}
