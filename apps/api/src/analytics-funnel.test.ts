/**
 * analytics.funnel and the Mission Control funnel card
 * (docs/specs/p2/revenue-pilot.md).
 *
 * The arithmetic is tested as a pure function elsewhere. What matters here is
 * the counting: that a touch which has moved on still counts toward the
 * milestones it passed, that the standing verdict is counted once per prospect
 * however often it was re-assessed, and that a funnel spanning an unapplied
 * migration says so instead of reporting a stage where everybody dropped out.
 */
import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { FakeDb, buildTestDeps, operatorJwt, testEnv } from './test/fakes.js';

const SPACE = '11111111-2222-3333-4444-555555555555';

class UndefinedTable extends Error {
  readonly code = '42P01';
}

function headers() {
  return { authorization: `Bearer ${operatorJwt(testEnv())}`, 'x-atlas-space': SPACE };
}

function app(db: FakeDb) {
  return buildApp({ deps: buildTestDeps(db) });
}

/** A database with a funnel that has actually moved. */
function dbWithFunnel(): FakeDb {
  const db = new FakeDb();
  db.when(/count\(\*\)::int as n from leads/i, [{ n: 40 }]);
  db.when(/from qualification_assessments[\s\S]*group by verdict/i, [
    { verdict: 'qualified', n: 12 },
    { verdict: 'eligibility_review', n: 10 },
    { verdict: 'disqualified', n: 8 },
  ]);
  db.when(/from demo_queue/i, [
    { state: 'queued', n: 2 },
    { state: 'shareable', n: 6 },
    { state: 'expired', n: 3 },
  ]);
  db.when(/count\(\*\)::int as n from outreach_sequences/i, [{ n: 6 }]);
  db.when(/from outreach_touches/i, [
    { state: 'replied', channel: 'email', n: 2 },
    { state: 'no_reply', channel: 'email', n: 2 },
    { state: 'sent', channel: 'email', n: 1 },
    { state: 'failed', channel: 'sms', n: 1 },
  ]);
  db.when(/count\(distinct lead_id\)::int as n from offers/i, [{ n: 2 }]);
  db.when(/from deal_decisions[\s\S]*group by state/i, [
    { state: 'accepted', n: 1 },
    { state: 'declined', n: 1 },
  ]);
  db.when(/from hosting_entitlements\s+where/i, [
    { state: 'active', n: 1 },
    { state: 'cancelled', n: 1 },
  ]);
  db.when(/select o.currency/i, [{ currency: 'USD', minor: 4900 }]);
  db.when(/jsonb_array_elements/i, [{ code: 'outside_cohort_region', n: 5 }]);
  return db;
}

async function funnel(db: FakeDb) {
  const res = await app(db).inject({
    method: 'GET',
    url: '/v1/analytics/funnel',
    headers: headers(),
  });
  return { statusCode: res.statusCode, body: res.json() as Record<string, unknown> };
}

type Stage = { id: string; count: number; conversionPercent: number | null; of: string | null };

function stage(body: Record<string, unknown>, id: string): Stage {
  const found = (body.stages as Stage[]).find((s) => s.id === id);
  if (!found) throw new Error(`no stage ${id}`);
  return found;
}

describe('analytics.funnel', () => {
  it('counts each stage from its own table', async () => {
    const { statusCode, body } = await funnel(dbWithFunnel());

    expect(statusCode).toBe(200);
    expect(stage(body, 'sourced').count).toBe(40);
    expect(stage(body, 'qualified').count).toBe(12);
    expect(stage(body, 'offer_published').count).toBe(2);
    expect(stage(body, 'accepted').count).toBe(1);
  });

  /**
   * A replied touch was sent and delivered first, but its row only carries its
   * current state. Counting `sent` alone would show sends falling as replies
   * arrive.
   */
  it('counts a touch toward every milestone it passed', async () => {
    const { body } = await funnel(dbWithFunnel());

    // 2 replied + 2 no_reply + 1 sent + 1 failed
    expect(stage(body, 'touch_sent').count).toBe(6);
    // delivered excludes the still-in-flight send and the failure
    expect((body.rates as Record<string, number | null>).deliveryRate).toBe(66.7);
    expect((body.rates as Record<string, number | null>).replyRate).toBe(50);
  });

  /** An expired demo no longer occupies a slot and is not queued. */
  it('excludes expired demos from the queue count', async () => {
    const { body } = await funnel(dbWithFunnel());
    expect(stage(body, 'demo_queued').count).toBe(8);
    expect(stage(body, 'demo_shareable').count).toBe(6);
  });

  it('counts every entitled state as a paying customer', async () => {
    const { body } = await funnel(dbWithFunnel());
    expect(stage(body, 'hosting_active').count).toBe(1);
    expect((body.revenue as { payingCustomers: number }).payingCustomers).toBe(1);
  });

  it('reports revenue per currency', async () => {
    const { body } = await funnel(dbWithFunnel());
    expect((body.revenue as { recurringMinorByCurrency: unknown }).recurringMinorByCurrency).toEqual({
      USD: 4900,
    });
  });

  it('reports per-channel counts and attributes nothing', async () => {
    const { body } = await funnel(dbWithFunnel());
    const contribution = body.channelContribution as {
      attribution: string;
      channels: Array<{ channel: string; sent: number; replied: number }>;
    };
    expect(contribution.attribution).toBe('none');
    expect(contribution.channels.map((c) => c.channel)).toEqual(['email', 'sms']);
    expect(contribution.channels[0]).toMatchObject({ channel: 'email', sent: 5, replied: 2 });
  });

  it('reports why prospects were disqualified', async () => {
    const { body } = await funnel(dbWithFunnel());
    expect(body.topBlockers).toEqual([{ code: 'outside_cohort_region', count: 5 }]);
  });

  /** The standing verdict is counted once per prospect, not once per row. */
  it('counts the latest assessment per lead', async () => {
    const db = dbWithFunnel();
    await funnel(db);
    const query = db.calls.find((c) => /from qualification_assessments/i.test(c.sql));
    expect(query?.sql).toMatch(/distinct on \(lead_id\)/);
  });
});

/** "Zero customers is recorded as evidence, not concealed." */
describe('an empty funnel', () => {
  it('reports every stage as empty and every rate as unknown', async () => {
    const { body } = await funnel(new FakeDb());

    expect(body.empty).toBe(true);
    expect(stage(body, 'sourced').count).toBe(0);
    for (const value of Object.values(body.rates as Record<string, number | null>)) {
      expect(value).toBeNull();
    }
  });

  it('names the metrics nothing records rather than defaulting them', async () => {
    const { body } = await funnel(new FakeDb());
    expect(body.unavailable).toContain('provider_cost');
    expect(body.unavailable).toContain('satisfaction');
  });
});

/**
 * A partial funnel would read as a funnel where everybody dropped out, so an
 * unapplied migration refuses the whole report.
 */
describe('when a funnel table is missing', () => {
  function dbMissing(pattern: RegExp): FakeDb {
    // FakeDb answers with the first matching responder, so the throwing one is
    // registered before any of the counting responders.
    const db = new FakeDb();
    db.when(pattern, () => {
      throw new UndefinedTable('relation does not exist');
    });
    return db;
  }

  it('reports schema_pending rather than a collapsed funnel', async () => {
    const { statusCode, body } = await funnel(dbMissing(/hosting_entitlements/i));

    expect(statusCode).toBe(200);
    expect(body.status).toBe('schema_pending');
    expect(body.stages).toBeUndefined();
  });

  /** A real fault must still be a fault. */
  it('does not swallow an unrelated database error', async () => {
    const db = new FakeDb();
    db.when(/from leads/i, () => {
      throw new Error('connection terminated');
    });
    const { statusCode } = await funnel(db);
    expect(statusCode).toBe(500);
  });
});

describe('the mission control funnel card', () => {
  async function cards(db: FakeDb) {
    const res = await app(db).inject({
      method: 'GET',
      url: '/v1/status/mission_control',
      headers: headers(),
    });
    const body = res.json() as { cards: Array<{ id: string; kind: string; data: Record<string, unknown> }> };
    return body.cards;
  }

  it('is included in the declarative payload', async () => {
    const card = (await cards(dbWithFunnel())).find((c) => c.id === 'funnel');
    expect(card).toBeDefined();
    expect(card?.kind).toBe('funnel');
    expect(card?.data.available).toBe(true);
    expect(Array.isArray(card?.data.stages)).toBe(true);
  });

  it('says the funnel is unavailable rather than showing an empty one', async () => {
    const db = new FakeDb();
    db.when(/hosting_entitlements/i, () => {
      throw new UndefinedTable('relation does not exist');
    });
    const card = (await cards(db)).find((c) => c.id === 'funnel');

    expect(card?.data.available).toBe(false);
    expect(String(card?.data.note)).toContain('0004');
  });
});
