/**
 * The P2C operator surface's card data (docs/specs/p2/revenue-pilot.md).
 *
 * Two things are under test, and the second matters more than the first.
 *
 * The cards must carry the pipeline. And the moves they offer must be DERIVED
 * from the rule functions, not restated — so these tests assert the derivation
 * against the rules themselves, and the mutation tests below prove the
 * derivation is load-bearing rather than a list that happens to agree today.
 */
import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { FakeDb, buildTestDeps, operatorJwt, testEnv } from './test/fakes.js';
import { DEMO_STATES, permittedDemoMoves, planAdvance } from './revenue/demo-queue.js';
import { TOUCH_STATES, permittedTouchMoves, planTouchAdvance } from './revenue/sequence.js';
import { DEAL_STATES, permittedDealMoves, planDealTransition } from './revenue/offers.js';
import {
  HOSTING_STATES,
  permittedHostingMoves,
  planAdvanceHosting,
} from './revenue/hosting-activation.js';

function appWith(db: FakeDb): FastifyInstance {
  return buildApp({ deps: buildTestDeps(db) });
}

async function cards(db: FakeDb): Promise<Record<string, Record<string, unknown>>> {
  const res = await appWith(db).inject({
    method: 'GET',
    url: '/v1/status/mission_control',
    headers: { authorization: `Bearer ${operatorJwt(testEnv())}` },
  });
  expect(res.statusCode).toBe(200);
  const body = res.json<{ cards: Array<{ id: string; data: Record<string, unknown> }> }>();
  return Object.fromEntries(body.cards.map((c) => [c.id, c.data]));
}

const LEAD = '11111111-1111-1111-1111-111111111111';

type Rows = Record<string, unknown>[];
type Override = [RegExp, Rows | (() => Rows)];

/**
 * A database with one lead somewhere in the middle of the pilot.
 *
 * `FakeDb` answers with the FIRST responder that matches, so overrides are
 * registered before the defaults rather than after them.
 */
function pilotDb(overrides: Override[] = []): FakeDb {
  const db = new FakeDb();
  for (const [re, rows] of overrides) db.when(re, rows as Rows);
  db.when(/from leads\b/i, [
    { lead_id: LEAD, business_name: 'Acme Plumbing', status: 'new', created_at: '2026-08-01T00:00:00.000Z' },
  ]);
  db.when(/from qualification_assessments/i, [
    {
      lead_id: LEAD,
      verdict: 'qualified',
      total: 27,
      created_at: '2026-08-01T00:00:00.000Z',
      // Well in the future, so `expired` must be false.
      expires_at: '2099-01-01T00:00:00.000Z',
    },
  ]);
  db.when(/from demo_queue/i, [
    {
      queue_id: 'q-1',
      lead_id: LEAD,
      state: 'building',
      site_id: null,
      expires_at: '2099-01-01T00:00:00.000Z',
    },
  ]);
  db.when(/from outreach_sequences/i, [
    { lead_id: LEAD, sequence_id: 's-1', version: 1, state: 'active', stopped_reason: null },
  ]);
  db.when(/from outreach_touches/i, [
    { touch_id: 't-1', sequence_id: 's-1', step: 1, channel: 'email', state: 'draft', sent_at: null },
    { touch_id: 't-2', sequence_id: 's-1', step: 2, channel: 'sms', state: 'scheduled', sent_at: null },
  ]);
  db.when(/from offers\b/i, [
    {
      lead_id: LEAD,
      offer_id: 'o-1',
      version: 2,
      country: 'JM',
      currency: 'JMD',
      price_minor: 0,
      period: 'monthly',
      terms_version: 'pilot-1',
    },
  ]);
  db.when(/from deal_decisions/i, [
    { lead_id: LEAD, state: 'offer_review', offer_version: 2, created_at: '2026-08-02T00:00:00.000Z' },
  ]);
  db.when(/from hosting_entitlements/i, [
    {
      lead_id: LEAD,
      entitlement_id: 'e-1',
      state: 'payment_pending',
      offer_version: 2,
      paid: false,
      renewal_enabled: true,
      activated_at: null,
      cancelled_at: null,
      serves_until: null,
    },
  ]);
  return db;
}

describe('prospects card', () => {
  it('carries the standing verdict, the demo slot and the queue against the cap', async () => {
    const data = (await cards(pilotDb())).prospects;
    expect(data.available).toBe(true);

    const [row] = data.items as Array<Record<string, unknown>>;
    expect(row.businessName).toBe('Acme Plumbing');
    expect(row.qualification).toMatchObject({ verdict: 'qualified', total: 27, expired: false });
    expect(row.demo).toMatchObject({ queueId: 'q-1', state: 'building' });

    expect(data.queue).toMatchObject({ active: 1, cap: 10, floor: 5, remaining: 9, belowFloor: true });
  });

  /** A demo may take exactly one step, or expire. Nothing else is offered. */
  it('offers only the moves planAdvance permits', async () => {
    const data = (await cards(pilotDb())).prospects;
    const [row] = data.items as Array<{ demo: { moves: string[] } }>;
    expect(row.demo.moves).toEqual(['qa', 'expired']);
    expect(row.demo.moves).toEqual(permittedDemoMoves('building'));
  });

  /** An expired assessment is stale evidence, and the card has to say so. */
  it('marks a lapsed assessment as expired', async () => {
    const db = pilotDb([
      [
        /from qualification_assessments/i,
        [
          {
            lead_id: LEAD,
            verdict: 'qualified',
            total: 27,
            created_at: '2020-01-01T00:00:00.000Z',
            expires_at: '2020-02-01T00:00:00.000Z',
          },
        ],
      ],
    ]);
    const data = (await cards(db)).prospects;
    const [row] = data.items as Array<{ qualification: { expired: boolean } }>;
    expect(row.qualification.expired).toBe(true);
  });

  /** Never assessed is not a verdict; it must not arrive as one. */
  it('reports an unassessed prospect as null rather than a verdict', async () => {
    const db = pilotDb([[/from qualification_assessments/i, []]]);
    const data = (await cards(db)).prospects;
    const [row] = data.items as Array<{ qualification: unknown }>;
    expect(row.qualification).toBeNull();
  });
});

describe('sequences card', () => {
  it('carries the plan, its touches, and the channels a plan may use', async () => {
    const data = (await cards(pilotDb())).sequences;
    expect(data.channels).toEqual(['email', 'sms', 'whatsapp', 'social_dm', 'phone']);
    expect(data.maxSteps).toBe(4);

    const [row] = data.items as Array<{ sequence: { state: string; touches: unknown[] } }>;
    expect(row.sequence.state).toBe('active');
    expect(row.sequence.touches).toHaveLength(2);
  });

  /**
   * The one that matters. A `scheduled` touch's only transition is to `sent`,
   * and only the approved outreach.send dispatch may record that — so the
   * operator surface must be offered nothing at all.
   */
  it('offers no move at all out of scheduled, because only the dispatch may send', async () => {
    const data = (await cards(pilotDb())).sequences;
    const [row] = data.items as Array<{
      sequence: { touches: Array<{ state: string; moves: unknown[] }> };
    }>;
    const scheduled = row.sequence.touches.find((t) => t.state === 'scheduled');
    expect(scheduled?.moves).toEqual([]);
  });

  it('flags the move that needs an approval as needing one', async () => {
    const moves = permittedTouchMoves({ sequenceState: 'active', from: 'approval_required' });
    expect(moves).toEqual([{ state: 'approved', requiresApproval: true }]);
  });
});

describe('revenue operations card', () => {
  it('carries the offer, the standing decision and the entitlement', async () => {
    const data = (await cards(pilotDb())).revenue_ops;
    expect(data.requiredDisclosures).toContain('cancellation_refund');
    expect(data.dealStates).toContain('accepted');

    const [row] = data.items as Array<Record<string, unknown>>;
    // Zero is a real price and must survive as one.
    expect(row.offer).toMatchObject({ version: 2, currency: 'JMD', priceMinor: 0 });
    expect(row.deal).toMatchObject({ state: 'offer_review', offerVersion: 2 });
    expect(row.entitlement).toMatchObject({
      state: 'payment_pending',
      paymentRecorded: false,
      entitled: false,
    });
  });

  /** The reference itself is never returned — only whether one exists. */
  it('never carries the payment reference', async () => {
    const db = pilotDb([
      [
        /from hosting_entitlements/i,
        [
          {
            lead_id: LEAD,
            entitlement_id: 'e-1',
            state: 'active',
            offer_version: 2,
            paid: true,
            renewal_enabled: true,
            activated_at: '2026-08-03T00:00:00.000Z',
            cancelled_at: null,
            // A reference the row carries but the card must never expose.
            payment_reference: 'ch_live_secret_ref',
            serves_until: null,
          },
        ],
      ],
    ]);
    const data = (await cards(db)).revenue_ops;
    const [row] = data.items as Array<{ entitlement: Record<string, unknown> }>;
    expect(row.entitlement.paymentRecorded).toBe(true);
    expect(row.entitlement.entitled).toBe(true);
    expect(JSON.stringify(row.entitlement)).not.toContain('ch_live_secret_ref');
  });
});

describe('honest degradation', () => {
  /**
   * A partial pipeline is the lie this refuses to tell: prospects rendered
   * without demo or offer state would read as a pilot where nothing had ever
   * been queued, rather than one whose schema is behind the code.
   */
  it('reports every P2C card unavailable when a table is missing, and keeps the rest of the dashboard', async () => {
    const db = pilotDb([
      [
        /from hosting_entitlements/i,
        () => {
          const err: Error & { code?: string } = new Error(
            'relation "hosting_entitlements" does not exist',
          );
          err.code = '42P01';
          throw err;
        },
      ],
    ]);

    const all = await cards(db);
    for (const id of ['prospects', 'sequences', 'revenue_ops']) {
      expect(all[id].available, id).toBe(false);
      expect(String(all[id].note), id).toContain('0004');
      expect(all[id].items, id).toEqual([]);
    }
    // The rest of Mission Control still rendered.
    expect(all.approvals).toBeDefined();
    expect(all.deployment).toBeDefined();
  });

  /** A real fault must not be disguised as a pending schema. */
  it('lets a non-schema error fail the request rather than reporting unavailable', async () => {
    const db = pilotDb([
      [
        /from offers\b/i,
        () => {
          throw new Error('connection reset');
        },
      ],
    ]);
    const res = await appWith(db).inject({
      method: 'GET',
      url: '/v1/status/mission_control',
      headers: { authorization: `Bearer ${operatorJwt(testEnv())}` },
    });
    expect(res.statusCode).toBe(500);
  });
});

/**
 * Mutation tests for the derivation itself.
 *
 * These do not re-implement the rules; they assert that the derived list is
 * exactly what the rule function permits, for every state. If someone replaces
 * the derivation with a hand-written table, a change to the rules breaks these
 * — which is the whole reason to derive.
 */
describe('derived moves track their rule function', () => {
  it('permittedDemoMoves agrees with planAdvance for every state pair', () => {
    for (const from of DEMO_STATES) {
      const expected = DEMO_STATES.filter((to) => planAdvance(from, to).ok);
      expect(permittedDemoMoves(from), from).toEqual(expected);
    }
  });

  it('permittedTouchMoves agrees with planTouchAdvance for every state pair', () => {
    for (const sequenceState of ['planned', 'active', 'stopped', 'completed']) {
      for (const from of TOUCH_STATES) {
        const expected = TOUCH_STATES.filter(
          (to) => planTouchAdvance({ sequenceState, from, to, approvalId: 'probe' }).ok,
        );
        expect(
          permittedTouchMoves({ sequenceState, from }).map((m) => m.state),
          `${sequenceState}/${from}`,
        ).toEqual(expected);
      }
    }
  });

  it('permittedHostingMoves agrees with planAdvanceHosting for every state', () => {
    for (const from of HOSTING_STATES) {
      const expected = HOSTING_STATES.filter(
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
      expect(permittedHostingMoves(from), from).toEqual(expected);
    }
  });

  /**
   * The two the surface must never offer, from any state: both are
   * approval-gated and belong to hosting.activate and hosting.cancel.
   */
  it('never offers entitlement_active or cancelled from any state', () => {
    for (const from of HOSTING_STATES) {
      expect(permittedHostingMoves(from), from).not.toContain('entitlement_active');
      expect(permittedHostingMoves(from), from).not.toContain('cancelled');
    }
  });

  /** `sent` is the one move the surface must never offer, in any state. */
  it('never offers sent from any state', () => {
    for (const sequenceState of ['planned', 'active']) {
      for (const from of TOUCH_STATES) {
        expect(
          permittedTouchMoves({ sequenceState, from }).map((m) => m.state),
        ).not.toContain('sent');
      }
    }
  });
});

/**
 * Deal moves are derived, like the demo and touch moves.
 *
 * Found by running the pilot through a browser: the card offered all five
 * deal states and left the API to refuse four of them, so `offer_review` from
 * `interested` looked like a legitimate choice and came back refused.
 */
describe('derived deal moves', () => {
  it('offers only what planDealTransition permits, for every state', () => {
    for (const from of DEAL_STATES) {
      for (const offerVersion of [null, 2]) {
        const expected = DEAL_STATES.filter(
          (to) => planDealTransition({ from, to, offerVersion }).ok,
        );
        expect(permittedDealMoves({ from, offerVersion }), `${from}/${offerVersion}`).toEqual(
          expected,
        );
      }
    }
  });

  /** The exact case the browser surfaced. */
  it('does not offer offer_review from interested', () => {
    expect(permittedDealMoves({ from: 'interested', offerVersion: 2 })).toEqual([
      'discovery',
      'declined',
    ]);
  });

  /** Reviewing or accepting names a published offer; with none, neither is offered. */
  it('offers no offer-bearing move when nothing is published', () => {
    expect(permittedDealMoves({ from: 'discovery', offerVersion: null })).toEqual(['declined']);
    expect(permittedDealMoves({ from: 'discovery', offerVersion: 1 })).toEqual([
      'offer_review',
      'declined',
    ]);
  });

  it('offers nothing once the deal is decided', () => {
    expect(permittedDealMoves({ from: 'accepted', offerVersion: 2 })).toEqual([]);
    expect(permittedDealMoves({ from: 'declined', offerVersion: 2 })).toEqual([]);
  });

  it('carries the derived moves on the revenue card', async () => {
    const data = (await cards(pilotDb())).revenue_ops;
    const [row] = data.items as Array<{ dealMoves: string[] }>;
    // The fixture stands at offer_review on offer v2.
    expect(row.dealMoves).toEqual(['accepted', 'declined']);
  });

  /**
   * A lead nobody has decided on offers interest as a first decision, not
   * instead of one. Reading absence as `interested` is what made the state
   * unrecordable, and the card read it the same way the handler did.
   */
  it('offers interest as a first decision when no decision exists', async () => {
    const db = pilotDb([[/from deal_decisions/i, []]]);
    const data = (await cards(db)).revenue_ops;
    const [row] = data.items as Array<{ dealMoves: string[]; deal: unknown }>;
    expect(row.dealMoves).toEqual(['interested', 'discovery', 'declined']);
    // And the lead still carries no decision — the offer is not a record.
    expect(row.deal).toBeNull();
  });
});
