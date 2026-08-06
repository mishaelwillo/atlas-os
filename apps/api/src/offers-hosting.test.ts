/**
 * Offers, deal decisions and the hosting activation gate through the pipeline
 * (docs/specs/p2/revenue-pilot.md).
 *
 * The rules are tested as pure functions elsewhere. What matters here is that
 * the gate holds on both sides of the approval — an activation that cannot
 * pass never reaches the queue, and one that was approved earlier is still
 * refused if the facts changed.
 */
import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { FakeDb, buildTestDeps, operatorJwt, testEnv } from './test/fakes.js';
import { REQUIRED_DISCLOSURES } from './revenue/offers.js';
import { planRecordTerms } from './revenue/hosting-activation.js';

const SPACE = '11111111-2222-3333-4444-555555555555';
const LEAD = '99999999-8888-7777-6666-555555555555';
const APPROVAL = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

class UndefinedTable extends Error {
  readonly code = '42P01';
}

const DISCLOSURES = Object.fromEntries(
  REQUIRED_DISCLOSURES.map((k) => [k, `plain-language ${k}`]),
);

function headers() {
  return { authorization: `Bearer ${operatorJwt(testEnv())}`, 'x-atlas-space': SPACE };
}

function app(db: FakeDb) {
  return buildApp({ deps: buildTestDeps(db) });
}

function dbWithLead(): FakeDb {
  const db = new FakeDb();
  db.when(/from leads where lead_id/i, [{ lead_id: LEAD }]);
  return db;
}

async function publish(db: FakeDb, overrides: Record<string, unknown> = {}) {
  const res = await app(db).inject({
    method: 'POST',
    url: '/v1/offers/publish',
    headers: headers(),
    payload: {
      leadId: LEAD,
      country: 'US',
      currency: 'USD',
      priceMinor: 4900,
      period: 'monthly',
      termsVersion: 'terms-2026-08',
      disclosures: DISCLOSURES,
      ...overrides,
    },
  });
  return { statusCode: res.statusCode, body: res.json() as Record<string, unknown> };
}

describe('offers.publish', () => {
  it('records an immutable version', async () => {
    const db = dbWithLead();
    db.when(/insert into offers/i, [{ offer_id: 'offer-1', version: 1 }]);
    const { body } = await publish(db);

    expect(body).toMatchObject({ published: true, offerId: 'offer-1', version: 1, currency: 'USD' });
  });

  /** There is no default price, and no silent USD assumption. */
  it('refuses an offer with no currency, and writes nothing', async () => {
    const db = dbWithLead();
    const { body } = await publish(db, { currency: '' });

    expect(body).toMatchObject({ published: false, code: 'currency_missing' });
    expect(db.calls.some((c) => /insert into offers/i.test(c.sql))).toBe(false);
  });

  it('refuses an offer missing a disclosure and names it', async () => {
    const db = dbWithLead();
    const partial = { ...DISCLOSURES };
    delete (partial as Record<string, string>).taxes;
    const { body } = await publish(db, { disclosures: partial });

    expect(body).toMatchObject({ published: false, code: 'disclosures_incomplete' });
    expect(body.missing).toEqual(['taxes']);
    expect(body.required).toEqual([...REQUIRED_DISCLOSURES]);
  });

  it('keeps what was actually disclosed with the version', async () => {
    const db = dbWithLead();
    db.when(/insert into offers/i, [{ offer_id: 'offer-1', version: 1 }]);
    await publish(db);
    const insert = db.calls.find((c) => /insert into offers/i.test(c.sql));
    expect(String(insert?.params?.[7])).toContain('cancellation_refund');
  });

  it('audits the published version', async () => {
    const db = dbWithLead();
    db.when(/insert into offers/i, [{ offer_id: 'offer-1', version: 2 }]);
    await publish(db);
    expect(db.auditInserts().some((a) => (a.params ?? []).includes('offers.published'))).toBe(true);
  });
});

describe('deals.decide', () => {
  function dbForDeal(options: { standing?: string; offerVersion?: number } = {}): FakeDb {
    const db = dbWithLead();
    db.when(
      /from deal_decisions where lead_id/i,
      options.standing ? [{ state: options.standing }] : [],
    );
    db.when(
      /from offers where lead_id/i,
      options.offerVersion === undefined
        ? []
        : [{ offer_id: 'offer-1', version: options.offerVersion }],
    );
    db.when(/insert into deal_decisions/i, [{ decision_id: 'dec-1' }]);
    return db;
  }

  async function decide(db: FakeDb, state: string) {
    const res = await app(db).inject({
      method: 'POST',
      url: '/v1/deals/decide',
      headers: headers(),
      payload: { leadId: LEAD, state },
    });
    return res.json() as Record<string, unknown>;
  }

  /**
   * A first decision names no prior state. It used to be counted from
   * `interested`, which meant no row could ever carry that state and a lead
   * who had expressed interest was indistinguishable from one nobody had
   * touched.
   */
  it('records a first decision with no prior state', async () => {
    const db = dbForDeal({ offerVersion: 1 });
    const body = await decide(db, 'discovery');
    expect(body).toMatchObject({ decided: true, first: true, to: 'discovery' });
    expect(body.from).toBeUndefined();
  });

  it('can record interest itself as the first decision', async () => {
    const db = dbForDeal({ offerVersion: 1 });
    const body = await decide(db, 'interested');
    expect(body).toMatchObject({ decided: true, first: true, to: 'interested' });
    expect(db.calls.some((c) => /insert into deal_decisions/i.test(c.sql))).toBe(true);
  });

  /** Interest is a first decision only. It is not somewhere a deal goes back to. */
  it('refuses to record interest once a deal has moved on', async () => {
    const db = dbForDeal({ standing: 'discovery', offerVersion: 1 });
    const body = await decide(db, 'interested');
    expect(body).toMatchObject({ decided: false, code: 'not_a_permitted_transition' });
    expect(db.calls.some((c) => /insert into deal_decisions/i.test(c.sql))).toBe(false);
  });

  /** A later state may still be recorded first; nobody has to invent a step. */
  it('lets a first decision skip straight to declined', async () => {
    const db = dbForDeal({ offerVersion: 1 });
    expect(await decide(db, 'declined')).toMatchObject({ decided: true, first: true });
  });

  /** The offer gate applies to a first decision exactly as it does to a move. */
  it('refuses a first decision of accepted with no published offer', async () => {
    const db = dbForDeal({});
    const body = await decide(db, 'accepted');
    expect(body).toMatchObject({ decided: false });
    expect(db.calls.some((c) => /insert into deal_decisions/i.test(c.sql))).toBe(false);
  });

  /** Accepting nothing in particular is the hidden-terms failure. */
  it('refuses to accept with no published offer', async () => {
    const db = dbForDeal({ standing: 'offer_review' });
    const body = await decide(db, 'accepted');

    expect(body).toMatchObject({ decided: false, code: 'offer_required' });
    expect(db.calls.some((c) => /insert into deal_decisions/i.test(c.sql))).toBe(false);
  });

  /** A caller naming a version that was never published cannot invent one. */
  it('resolves the offer from the table, not the request', async () => {
    const db = dbWithLead();
    db.when(/from deal_decisions where lead_id/i, [{ state: 'offer_review' }]);
    db.when(/from offers where lead_id/i, []);
    const res = await app(db).inject({
      method: 'POST',
      url: '/v1/deals/decide',
      headers: headers(),
      payload: { leadId: LEAD, state: 'accepted', offerVersion: 99 },
    });
    expect(res.json()).toMatchObject({ decided: false, code: 'offer_required' });
  });

  it('refuses to skip discovery', async () => {
    const db = dbForDeal({ standing: 'interested', offerVersion: 1 });
    expect(await decide(db, 'accepted')).toMatchObject({
      decided: false,
      code: 'not_a_permitted_transition',
    });
  });

  it('records an acceptance against the offer version', async () => {
    const db = dbForDeal({ standing: 'offer_review', offerVersion: 3 });
    const body = await decide(db, 'accepted');

    expect(body).toMatchObject({ decided: true, to: 'accepted', offerVersion: 3 });
    const insert = db.calls.find((c) => /insert into deal_decisions/i.test(c.sql));
    expect((insert?.params ?? []).includes(3)).toBe(true);
  });
});

/**
 * The acceptance: "Hosting cannot activate before approved terms and confirmed
 * payment." The gate is checked before the approval is created and again in the
 * dispatcher.
 */
describe('the hosting activation gate', () => {
  function dbForActivation(options: {
    state?: string;
    dealState?: string | null;
    acceptedVersion?: number | null;
    entitlementVersion?: number;
    payment?: string | null;
    disclosures?: Record<string, string>;
  } = {}): FakeDb {
    const db = new FakeDb();
    db.when(/from hosting_entitlements\s+where lead_id = \$1 and state <> 'cancelled'/i, [
      {
        entitlement_id: 'ent-1',
        state: options.state ?? 'payment_pending',
        offer_version: options.entitlementVersion ?? 2,
        payment_reference: options.payment === undefined ? 'prov_ref_1' : options.payment,
      },
    ]);
    db.when(
      /from deal_decisions\s+where lead_id/i,
      options.dealState === null
        ? []
        : [
            {
              state: options.dealState ?? 'accepted',
              offer_version: options.acceptedVersion === undefined ? 2 : options.acceptedVersion,
            },
          ],
    );
    db.when(/from offers where lead_id = \$1 and version/i, [
      { disclosures: options.disclosures ?? DISCLOSURES },
    ]);
    db.when(/insert into approvals/i, [{ approval_id: APPROVAL }]);
    return db;
  }

  async function request(db: FakeDb) {
    const res = await app(db).inject({
      method: 'POST',
      url: '/v1/hosting/activate',
      headers: headers(),
      payload: { leadId: LEAD },
    });
    return { statusCode: res.statusCode, body: res.json() as Record<string, unknown> };
  }

  it('queues an approval when every condition is met', async () => {
    const { statusCode, body } = await request(dbForActivation());
    expect(statusCode).toBe(200);
    expect(body).toMatchObject({ approvalId: APPROVAL, status: 'review' });
  });

  it('refuses before an approval exists when terms were never accepted', async () => {
    const db = dbForActivation({ dealState: null });
    const { statusCode, body } = await request(db);

    expect(statusCode).toBe(409);
    expect(body.code).toBe('terms_not_accepted');
    expect(db.calls.some((c) => /insert into approvals/i.test(c.sql))).toBe(false);
  });

  it('refuses when no payment reference is recorded', async () => {
    const { statusCode, body } = await request(dbForActivation({ payment: null }));
    expect(statusCode).toBe(409);
    expect(body.code).toBe('payment_not_confirmed');
  });

  /** A customer who accepted one offer must not be activated onto another. */
  it('refuses when the accepted offer is not the one being activated', async () => {
    const { body } = await request(dbForActivation({ acceptedVersion: 1, entitlementVersion: 2 }));
    expect(body.code).toBe('offer_version_mismatch');
  });

  it('refuses when the accepted offer was missing a disclosure', async () => {
    const partial = { ...DISCLOSURES };
    delete (partial as Record<string, string>).renewal;
    const { body } = await request(dbForActivation({ disclosures: partial }));
    expect(body.code).toBe('disclosures_incomplete');
  });

  it('audits the refusal', async () => {
    const db = dbForActivation({ payment: null });
    await request(db);
    expect(
      db.auditInserts().some((a) => (a.params ?? []).includes('hosting.activate.refused')),
    ).toBe(true);
  });
});

describe('the gate again at dispatch', () => {
  function dbForDispatch(options: { payment?: string | null; dealState?: string } = {}): FakeDb {
    const db = new FakeDb();
    db.when(/from approvals where approval_id/i, [
      {
        approval_id: APPROVAL,
        space_id: SPACE,
        run_id: null,
        kind: 'hosting.activate',
        payload: { input: { leadId: LEAD } },
      },
    ]);
    db.when(/from hosting_entitlements\s+where lead_id = \$1 and state <> 'cancelled'/i, [
      {
        entitlement_id: 'ent-1',
        state: 'payment_pending',
        offer_version: 2,
        payment_reference: options.payment === undefined ? 'prov_ref_1' : options.payment,
      },
    ]);
    db.when(/from deal_decisions\s+where lead_id/i, [
      { state: options.dealState ?? 'accepted', offer_version: 2 },
    ]);
    db.when(/from offers where lead_id = \$1 and version/i, [{ disclosures: DISCLOSURES }]);
    return db;
  }

  async function decide(db: FakeDb) {
    const res = await app(db).inject({
      method: 'POST',
      url: '/v1/approvals/decide',
      headers: { authorization: `Bearer ${operatorJwt(testEnv())}` },
      payload: { approvalId: APPROVAL, decision: 'approved' },
    });
    return (res.json() as { dispatched: Record<string, unknown> }).dispatched;
  }

  it('activates when the facts still hold', async () => {
    const db = dbForDispatch();
    const dispatched = await decide(db);

    expect(dispatched).toMatchObject({ executed: true, state: 'entitlement_active' });
    expect(db.calls.some((c) => /set state = 'entitlement_active'/i.test(c.sql))).toBe(true);
  });

  /**
   * The reason the gate runs twice: an approval says an operator was willing to
   * activate, not that the payment is still recorded.
   */
  it('refuses at dispatch when the payment reference has gone', async () => {
    const db = dbForDispatch({ payment: null });
    const dispatched = await decide(db);

    expect(dispatched).toMatchObject({ executed: false, code: 'payment_not_confirmed' });
    expect(db.calls.some((c) => /set state = 'entitlement_active'/i.test(c.sql))).toBe(false);
  });

  it('refuses at dispatch when the deal was withdrawn', async () => {
    const dispatched = await decide(dbForDispatch({ dealState: 'declined' }));
    expect(dispatched).toMatchObject({ executed: false, code: 'terms_not_accepted' });
  });
});

describe('hosting.cancel', () => {
  function dbForCancel(state: string): FakeDb {
    const db = new FakeDb();
    db.when(/from approvals where approval_id/i, [
      {
        approval_id: APPROVAL,
        space_id: SPACE,
        run_id: null,
        kind: 'hosting.cancel',
        payload: { input: { leadId: LEAD } },
      },
    ]);
    db.when(/from hosting_entitlements\s+where lead_id = \$1 order by/i, [
      { entitlement_id: 'ent-1', state },
    ]);
    return db;
  }

  async function decide(db: FakeDb) {
    const res = await app(db).inject({
      method: 'POST',
      url: '/v1/approvals/decide',
      headers: { authorization: `Bearer ${operatorJwt(testEnv())}` },
      payload: { approvalId: APPROVAL, decision: 'approved' },
    });
    return (res.json() as { dispatched: Record<string, unknown> }).dispatched;
  }

  it('disables renewal and keeps serving a paid period', async () => {
    const db = dbForCancel('active');
    const dispatched = await decide(db);

    expect(dispatched).toMatchObject({
      executed: true,
      renewalEnabled: false,
      servesUntilPeriodEnd: true,
    });
  });

  /** Cancellation preserves export and history: nothing is deleted. */
  it('deletes nothing', async () => {
    const db = dbForCancel('active');
    await decide(db);
    expect(db.calls.some((c) => /\bdelete\b/i.test(c.sql))).toBe(false);
  });

  it('refuses to cancel twice', async () => {
    const dispatched = await decide(dbForCancel('cancelled'));
    expect(dispatched).toMatchObject({ executed: false, code: 'already_cancelled' });
  });
});

/**
 * hosting.advance — the two states nothing could reach.
 *
 * `hosting.activate` hardcoded `entitlement_active` as its target and nothing
 * went further, so `onboarded` and `active` were declared by the transition
 * table and counted by the funnel's SQL while no caller could produce either.
 */
describe('hosting.advance', () => {
  function dbWithEntitlement(state: string): FakeDb {
    const db = new FakeDb();
    db.when(/from hosting_entitlements where lead_id = \$1 order by/i, [
      { entitlement_id: 'ent-1', state, offer_version: 2, payment_reference: 'pi_3Q' },
    ]);
    db.when(/from deal_decisions\s+where lead_id/i, [{ state: 'accepted', offer_version: 2 }]);
    return db;
  }

  async function advance(db: FakeDb, state: string) {
    const res = await app(db).inject({
      method: 'POST',
      url: '/v1/hosting/advance',
      headers: headers(),
      payload: { leadId: LEAD, state },
    });
    return { statusCode: res.statusCode, body: res.json() as Record<string, unknown> };
  }

  it('records onboarding', async () => {
    const { body } = await advance(dbWithEntitlement('entitlement_active'), 'onboarded');
    expect(body).toMatchObject({ advanced: true, from: 'entitlement_active', state: 'onboarded' });
  });

  it('records a customer going live', async () => {
    const { body } = await advance(dbWithEntitlement('onboarded'), 'active');
    expect(body).toMatchObject({ advanced: true, state: 'active' });
  });

  it('writes the new state and audits the move', async () => {
    const db = dbWithEntitlement('entitlement_active');
    await advance(db, 'onboarded');
    expect(db.calls.some((c) => /update hosting_entitlements set state/i.test(c.sql))).toBe(true);
    expect(db.calls.some((c) => /insert into audit_log/i.test(c.sql))).toBe(true);
  });

  /**
   * The safety property, exercised through the route rather than the planner.
   * Activation and cancellation are approval-gated; an advance that let either
   * through would be a way past the approval queue entirely.
   */
  it('refuses to activate, and creates no approval either', async () => {
    const db = dbWithEntitlement('payment_pending');
    const { body } = await advance(db, 'entitlement_active');
    expect(body).toMatchObject({ advanced: false, code: 'not_an_advance_target' });
    expect(String(body.note)).toContain('hosting.activate');
    expect(db.calls.some((c) => /update hosting_entitlements set state/i.test(c.sql))).toBe(false);
    expect(db.calls.some((c) => /insert into approvals/i.test(c.sql))).toBe(false);
  });

  it('refuses to cancel', async () => {
    const db = dbWithEntitlement('active');
    const { body } = await advance(db, 'cancelled');
    expect(body).toMatchObject({ advanced: false, code: 'not_an_advance_target' });
    expect(db.calls.some((c) => /update hosting_entitlements set state/i.test(c.sql))).toBe(false);
  });

  it('refuses a move the transition table does not permit', async () => {
    const { body } = await advance(dbWithEntitlement('terms_approved'), 'active');
    expect(body).toMatchObject({ advanced: false, code: 'not_a_permitted_transition' });
  });

  it('refuses when there is no entitlement to move', async () => {
    const db = new FakeDb();
    db.when(/from hosting_entitlements where lead_id = \$1 order by/i, []);
    const { body } = await advance(db, 'onboarded');
    expect(body).toMatchObject({ advanced: false, code: 'no_entitlement' });
  });

  it('requires a target state', async () => {
    const res = await app(dbWithEntitlement('entitlement_active')).inject({
      method: 'POST',
      url: '/v1/hosting/advance',
      headers: headers(),
      payload: { leadId: LEAD },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('before migration 0006 is applied', () => {
  function dbWithoutTables(): FakeDb {
    const db = new FakeDb();
    db.when(/from leads where lead_id/i, [{ lead_id: LEAD }]);
    db.when(/offers|deal_decisions|hosting_entitlements/i, () => {
      throw new UndefinedTable('relation does not exist');
    });
    return db;
  }

  it('publishes nothing and says why', async () => {
    const { body } = await publish(dbWithoutTables());
    expect(body.status).toBe('schema_pending');
    expect(String(body.note)).toContain('0006_offers_and_hosting');
  });

  it('reports the pending schema from hosting.state', async () => {
    const res = await app(dbWithoutTables()).inject({
      method: 'GET',
      url: `/v1/hosting/state?leadId=${LEAD}`,
      headers: headers(),
    });
    const body = res.json() as Record<string, unknown>;
    expect(body.status).toBe('schema_pending');
    expect(body.entitlement).toBeUndefined();
  });

  /** A real fault must still be a fault. */
  it('does not swallow an unrelated database error', async () => {
    const db = dbWithLead();
    db.when(/insert into offers/i, () => {
      throw new Error('connection terminated');
    });
    const { statusCode } = await publish(db);
    expect(statusCode).toBe(500);
  });
});

/**
 * hosting.record_terms — the entrance the chain was missing.
 *
 * activate moves an entitlement, cancel ends one, state reads one; nothing
 * created one, so "one paying customer" was unreachable through the product.
 * Found by approving a real activation in Mission Control and reading the
 * refusal: "no hosting entitlement for this lead".
 */
describe('planRecordTerms', () => {
  const accepted = {
    dealState: 'accepted',
    acceptedOfferVersion: 2,
    disclosuresComplete: true,
    existingState: null,
    paymentReference: null,
  };

  it('records terms_approved when only the decision is known', () => {
    const plan = planRecordTerms(accepted);
    expect(plan).toMatchObject({ ok: true, state: 'terms_approved', offerVersion: 2, paymentReference: null });
  });

  /** The operator already holds the provider's reference. Still entitles nobody. */
  it('records payment_pending when a provider reference is supplied', () => {
    const plan = planRecordTerms({ ...accepted, paymentReference: ' ch_3Abc123 ' });
    expect(plan).toMatchObject({ ok: true, state: 'payment_pending', paymentReference: 'ch_3Abc123' });
  });

  it('refuses terms nobody accepted', () => {
    expect(planRecordTerms({ ...accepted, dealState: 'offer_review' })).toMatchObject({
      ok: false,
      code: 'terms_not_accepted',
    });
    expect(planRecordTerms({ ...accepted, dealState: null })).toMatchObject({
      ok: false,
      code: 'terms_not_accepted',
    });
  });

  /** The same check the activation gate makes, for the same reason. */
  it('refuses an accepted deal that names no offer version', () => {
    expect(planRecordTerms({ ...accepted, acceptedOfferVersion: null })).toMatchObject({
      ok: false,
      code: 'offer_version_mismatch',
    });
  });

  it('refuses an offer version whose disclosures are incomplete', () => {
    expect(planRecordTerms({ ...accepted, disclosuresComplete: false })).toMatchObject({
      ok: false,
      code: 'disclosures_incomplete',
    });
  });

  it('refuses a second entitlement while one stands', () => {
    const plan = planRecordTerms({ ...accepted, existingState: 'payment_pending' });
    expect(plan).toMatchObject({ ok: false, code: 'already_recorded' });
    expect((plan as { message: string }).message).toContain('payment_pending');
  });

  /** A cancelled entitlement does not block a returning customer. */
  it('allows new terms after a cancellation', () => {
    expect(planRecordTerms({ ...accepted, existingState: null })).toMatchObject({ ok: true });
  });

  /**
   * The one input Atlas must never hold. An operator copying the wrong field
   * from a provider console is exactly how card data would arrive.
   */
  it('refuses a payment reference shaped like a card number', () => {
    for (const pan of ['4111111111111111', '4111 1111 1111 1111', '4111-1111-1111-1111', '378282246310005']) {
      expect(planRecordTerms({ ...accepted, paymentReference: pan }), pan).toMatchObject({
        ok: false,
        code: 'payment_reference_looks_like_card_data',
      });
    }
  });

  it('accepts a real provider reference that merely contains digits', () => {
    for (const ref of ['ch_3Abc123XyZ', 'pi_1234567890', 'INV-2026-000123', '1234']) {
      expect(planRecordTerms({ ...accepted, paymentReference: ref }), ref).toMatchObject({ ok: true });
    }
  });

  it('treats a blank reference as none rather than as a value', () => {
    expect(planRecordTerms({ ...accepted, paymentReference: '   ' })).toMatchObject({
      ok: true,
      state: 'terms_approved',
      paymentReference: null,
    });
  });
});
