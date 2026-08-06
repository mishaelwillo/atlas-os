/**
 * Every revenue state machine, declared so its reachability can be checked
 * (docs/specs/p2/revenue-pilot.md, "Workflow and states").
 *
 * The hosting chain shipped with three of its seven states unreachable by any
 * caller while four separate pieces of code spoke as though they were not.
 * That was found by looking; this is what makes looking automatic. Each
 * machine names its entrances and probes its own planner, so the answer comes
 * from the rules the handlers actually run rather than from a table restated
 * here.
 *
 * `canRequest` is the one hand-written part, and deliberately so: it describes
 * what the capabilities do, which is the thing being compared against the
 * transition tables. Deriving it from those tables would compare a claim with
 * itself.
 */

import { DEMO_STATES, planAdvance } from './demo-queue.js';
import { DEAL_STATES, planDealTransition } from './offers.js';
import { TOUCH_STATES, planTouchAdvance } from './sequence.js';
import {
  ACTIVATION_TARGET_STATE,
  CANCELLATION_TARGET_STATE,
  DEFERRED_HOSTING_STATES,
  HOSTING_STATES,
  TERMS_ENTRY_STATES,
  planAdvanceHosting,
  planCancellation,
  planHostingTransition,
} from './hosting-activation.js';
import type { StateMachine } from './reachability.js';

/**
 * Commercial facts supplied as satisfied when probing a planner.
 *
 * Reachability asks whether a path exists at all, not whether today's data
 * takes it. A prospect with no accepted deal cannot activate hosting, but that
 * is a fact about the prospect; it must not be reported as a state the product
 * cannot reach.
 */
const SATISFIED = {
  dealState: 'accepted',
  acceptedOfferVersion: 1,
  entitlementOfferVersion: 1,
  disclosuresComplete: true,
  paymentReference: 'probe',
} as const;

/**
 * Hosting entitlements.
 *
 * Three capabilities move one: `hosting.activate` (approval-gated, targets
 * `entitlement_active`), `hosting.advance` (operator-only, the delivery
 * states) and `hosting.cancel` (approval-gated). Each is probed through the
 * planner that actually decides it.
 */
export const hostingMachine: StateMachine = {
  name: 'hosting entitlement',
  states: HOSTING_STATES,
  // hosting.record_terms inserts one of these.
  entry: TERMS_ENTRY_STATES,
  canRequest: (from, to) => {
    if (to === ACTIVATION_TARGET_STATE) return planHostingTransition({ from, to, ...SATISFIED }).ok;
    if (to === CANCELLATION_TARGET_STATE) return planCancellation(from).ok;
    return planAdvanceHosting({ from, to, ...SATISFIED }).ok;
  },
  deferred: DEFERRED_HOSTING_STATES,
};

/**
 * Demo queue slots. `demos.enqueue` creates `queued`; `demos.advance` passes
 * the requested target straight to `planAdvance`, so the planner is the whole
 * answer.
 */
export const demoMachine: StateMachine = {
  name: 'demo queue',
  states: DEMO_STATES,
  entry: ['queued'],
  canRequest: (from, to) => planAdvance(from, to).ok,
  deferred: {},
};

/**
 * Outreach touches. `automation.sequence` plans them as `draft`;
 * `sequence.advance` passes the requested target to `planTouchAdvance`.
 *
 * `scheduled → sent` is the one move a sequence caller can never make — it
 * belongs to the approved `outreach.send` dispatcher, which sets a flag no
 * request body can. That path is still a path through the product, so
 * reachability grants the flag for exactly that move and no other. Granting it
 * everywhere would hide a real gap; withholding it would report `sent` as
 * unreachable when an approved send reaches it every time.
 */
export const touchMachine: StateMachine = {
  name: 'outreach touch',
  states: TOUCH_STATES,
  entry: ['draft'],
  canRequest: (from, to) =>
    planTouchAdvance({
      sequenceState: 'active',
      from,
      to,
      approvalId: 'probe',
      viaDispatcher: from === 'scheduled' && to === 'sent',
    }).ok,
  deferred: {},
};

/**
 * Deal decisions.
 *
 * No insert carries a starting state — `deals.decide` writes only the
 * transition's target — so the entrances are whatever a *first* decision may
 * write, probed with `from: null`. Null is the honest input: a deal nobody has
 * recorded is not a deal somebody was interested in, and reading it as one is
 * what made `interested` unrecordable until this check found it.
 */
export const dealMachine: StateMachine = {
  name: 'deal decision',
  states: DEAL_STATES,
  entry: DEAL_STATES.filter((to) => planDealTransition({ from: null, to, offerVersion: 1 }).ok),
  canRequest: (from, to) => planDealTransition({ from, to, offerVersion: 1 }).ok,
  deferred: {},
};

export const REVENUE_STATE_MACHINES: readonly StateMachine[] = [
  hostingMachine,
  demoMachine,
  touchMachine,
  dealMachine,
] as const;
