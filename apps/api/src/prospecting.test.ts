/**
 * prospecting.* and demos.* through the pipeline
 * (docs/specs/p2/revenue-pilot.md).
 *
 * The rubric and the queue rules are tested as pure functions elsewhere. What
 * matters here is what the capability does with them: that the verdict is
 * derived rather than accepted, that suppression comes from the lead row and
 * not the request, that a refused slot writes nothing, and that a database
 * without migration 0004 is reported honestly instead of failing.
 */
import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { FakeDb, buildTestDeps, operatorJwt, testEnv } from './test/fakes.js';
import { DEMO_QUEUE_CAP } from './revenue/demo-queue.js';

const SPACE = '11111111-2222-3333-4444-555555555555';
const LEAD = '99999999-8888-7777-6666-555555555555';

/** Evidence that qualifies, matching the rubric fixture. */
const QUALIFYING = {
  region: 'north-america',
  vertical: 'trades',
  targetRegions: ['north-america'],
  targetVerticals: ['trades'],
  activeProfile: true,
  websiteUrl: null,
  identityVerified: true,
  locationVerified: true,
  publicFactCount: 5,
  contactSource: 'https://maps.example/acme',
  contactPolicyReviewed: true,
  operatingStatus: 'open',
  demoEffortHours: 1,
  deceptiveDemoRisk: false,
  benefitRationale: 'no site at all; customers cannot find opening hours',
};

/** Postgres reports a table that does not exist with this code. */
class UndefinedTable extends Error {
  readonly code = '42P01';
}

function dbWithLead(status = 'new'): FakeDb {
  const db = new FakeDb();
  db.when(/from leads where lead_id/i, [{ lead_id: LEAD, status }]);
  db.when(/insert into qualification_assessments/i, [{ assessment_id: 'assess-1' }]);
  db.when(/insert into demo_queue/i, [{ queue_id: 'queue-1' }]);
  return db;
}

function app(db: FakeDb) {
  return buildApp({ deps: buildTestDeps(db) });
}

function headers() {
  return {
    authorization: `Bearer ${operatorJwt(testEnv())}`,
    'x-atlas-space': SPACE,
  };
}

async function qualify(db: FakeDb, evidence: Record<string, unknown> = QUALIFYING) {
  const res = await app(db).inject({
    method: 'POST',
    url: '/v1/prospecting/qualify',
    headers: headers(),
    payload: { leadId: LEAD, evidence },
  });
  return { statusCode: res.statusCode, body: res.json() as Record<string, unknown> };
}

describe('prospecting.qualify', () => {
  it('records a qualified assessment with its derived score', async () => {
    const db = dbWithLead();
    const { statusCode, body } = await qualify(db);

    expect(statusCode).toBe(200);
    expect(body.verdict).toBe('qualified');
    expect(body.assessmentId).toBe('assess-1');
    expect(typeof body.total).toBe('number');
    expect(body.expiresAt).toMatch(/^\d{4}-/);
  });

  /**
   * The verdict is derived from the evidence, never taken from the caller.
   * Otherwise the rubric is decoration and an operator can assert their way to
   * a demo slot.
   */
  it('ignores a verdict supplied by the caller', async () => {
    const db = dbWithLead();
    const { body } = await qualify(db, { ...QUALIFYING, operatingStatus: 'closed', verdict: 'qualified' });
    expect(body.verdict).toBe('disqualified');
  });

  /** Suppression is a fact about the lead; omitting the field must not clear it. */
  it('reads suppression from the lead row, not the request', async () => {
    const db = dbWithLead('suppressed');
    const { body } = await qualify(db);

    expect(body.verdict).toBe('disqualified');
    expect((body.blockers as Array<{ code: string }>).map((b) => b.code)).toContain('suppressed');
  });

  it('sends an incomplete prospect to eligibility review', async () => {
    const db = dbWithLead();
    const { body } = await qualify(db, { ...QUALIFYING, contactPolicyReviewed: false });

    expect(body.verdict).toBe('eligibility_review');
    expect((body.unknowns as Array<{ code: string }>).map((u) => u.code)).toContain(
      'contact_policy_unreviewed',
    );
  });

  /** `leads.status` is the outreach lifecycle and must not be rewritten here. */
  it('never writes the lead row', async () => {
    const db = dbWithLead();
    await qualify(db, { ...QUALIFYING, operatingStatus: 'closed' });
    expect(db.calls.some((c) => /update leads/i.test(c.sql))).toBe(false);
  });

  it('stores the evidence the verdict was derived from', async () => {
    const db = dbWithLead();
    await qualify(db);
    const insert = db.calls.find((c) => /insert into qualification_assessments/i.test(c.sql));
    expect(insert).toBeDefined();
    expect(String(insert?.params?.[9])).toContain('contactPolicyReviewed');
  });

  it('audits the assessment', async () => {
    const db = dbWithLead();
    await qualify(db);
    expect(db.auditInserts().some((a) => (a.params ?? []).includes('prospecting.qualified'))).toBe(
      true,
    );
  });

  it('reports an unknown lead rather than assessing nothing', async () => {
    const db = new FakeDb();
    const { statusCode } = await qualify(db);
    expect(statusCode).toBe(404);
  });
});

describe('demos.enqueue', () => {
  function dbForQueue(options: {
    verdict?: string;
    expiresAt?: string;
    active?: Array<{ queue_id: string; lead_id: string; state: string }>;
  }): FakeDb {
    const db = dbWithLead();
    db.when(
      /from qualification_assessments/i,
      options.verdict === undefined
        ? []
        : [
            {
              assessment_id: 'assess-1',
              verdict: options.verdict,
              expires_at: options.expiresAt ?? new Date(Date.now() + 86400000).toISOString(),
            },
          ],
    );
    db.when(/from demo_queue where state/i, options.active ?? []);
    return db;
  }

  async function enqueue(db: FakeDb) {
    const res = await app(db).inject({
      method: 'POST',
      url: '/v1/demos/enqueue',
      headers: headers(),
      payload: { leadId: LEAD },
    });
    return res.json() as Record<string, unknown>;
  }

  it('admits a qualified prospect and reports the slots left', async () => {
    const db = dbForQueue({ verdict: 'qualified' });
    const body = await enqueue(db);

    expect(body.enqueued).toBe(true);
    expect(body.queueId).toBe('queue-1');
    expect(body.remaining).toBe(DEMO_QUEUE_CAP - 1);
    expect(body.belowFloor).toBe(true);
  });

  it('refuses a prospect nobody qualified, and records nothing', async () => {
    const db = dbForQueue({});
    const body = await enqueue(db);

    expect(body.enqueued).toBe(false);
    expect(body.code).toBe('not_qualified');
    expect(db.calls.some((c) => /insert into demo_queue/i.test(c.sql))).toBe(false);
  });

  it('refuses a prospect whose assessment has gone stale', async () => {
    const db = dbForQueue({ verdict: 'qualified', expiresAt: '2020-01-01T00:00:00.000Z' });
    expect((await enqueue(db)).code).toBe('assessment_expired');
  });

  it('refuses at the pilot cap', async () => {
    const active = Array.from({ length: DEMO_QUEUE_CAP }, (_, i) => ({
      queue_id: `q-${i}`,
      lead_id: `lead-${i}`,
      state: 'queued',
    }));
    const db = dbForQueue({ verdict: 'qualified', active });
    const body = await enqueue(db);

    expect(body.code).toBe('cap_reached');
    expect(db.calls.some((c) => /insert into demo_queue/i.test(c.sql))).toBe(false);
  });

  it('audits a refusal so a blocked slot is not silent', async () => {
    const db = dbForQueue({});
    await enqueue(db);
    expect(db.auditInserts().some((a) => (a.params ?? []).includes('demos.enqueue_refused'))).toBe(
      true,
    );
  });

  it('links the slot to the assessment that admitted it', async () => {
    const db = dbForQueue({ verdict: 'qualified' });
    await enqueue(db);
    const insert = db.calls.find((c) => /insert into demo_queue/i.test(c.sql));
    expect((insert?.params ?? []).includes('assess-1')).toBe(true);
  });
});

describe('demos.advance', () => {
  function dbWithSlot(state: string): FakeDb {
    const db = dbWithLead();
    db.when(/from demo_queue where queue_id/i, [{ queue_id: 'queue-1', state }]);
    return db;
  }

  async function advance(db: FakeDb, to: string) {
    const res = await app(db).inject({
      method: 'POST',
      url: '/v1/demos/advance',
      headers: headers(),
      payload: { queueId: 'queue-1', state: to },
    });
    return res.json() as Record<string, unknown>;
  }

  it('moves a demo one declared step', async () => {
    const db = dbWithSlot('queued');
    const body = await advance(db, 'building');

    expect(body).toMatchObject({ advanced: true, from: 'queued', to: 'building' });
    expect(db.calls.some((c) => /update demo_queue/i.test(c.sql))).toBe(true);
  });

  /** The state is read from the row, so a caller cannot step from a claim. */
  it('refuses a jump past QA and changes nothing', async () => {
    const db = dbWithSlot('queued');
    const body = await advance(db, 'approved');

    expect(body.advanced).toBe(false);
    expect(body.code).toBe('not_the_next_state');
    expect(db.calls.some((c) => /update demo_queue/i.test(c.sql))).toBe(false);
  });

  it('expires a demo in flight', async () => {
    expect(await advance(dbWithSlot('qa'), 'expired')).toMatchObject({ advanced: true, to: 'expired' });
  });

  it('reports a slot that does not exist', async () => {
    const res = await app(new FakeDb()).inject({
      method: 'POST',
      url: '/v1/demos/advance',
      headers: headers(),
      payload: { queueId: 'queue-1', state: 'building' },
    });
    expect(res.statusCode).toBe(404);
  });
});

/**
 * Migration 0004 is written but not applied. Until it runs these capabilities
 * must say so and change nothing — a 500 would be indistinguishable from a real
 * fault, and reporting success would be worse than either.
 */
describe('before migration 0004 is applied', () => {
  function dbWithoutTables(): FakeDb {
    const db = new FakeDb();
    db.when(/from leads where lead_id/i, [{ lead_id: LEAD, status: 'new' }]);
    db.when(/qualification_assessments|demo_queue/i, () => {
      throw new UndefinedTable('relation does not exist');
    });
    return db;
  }

  it('reports the pending schema from qualify, and still returns the verdict', async () => {
    const { statusCode, body } = await qualify(dbWithoutTables());

    expect(statusCode).toBe(200);
    expect(body.status).toBe('schema_pending');
    expect(String(body.note)).toContain('0004_prospect_qualification');
    // The rubric is pure, so its answer is available even with nothing stored.
    expect(body.verdict).toBe('qualified');
    expect(body.assessmentId).toBeUndefined();
  });

  it('reports the pending schema from the workspace', async () => {
    const res = await app(dbWithoutTables()).inject({
      method: 'GET',
      url: '/v1/prospecting/workspace',
      headers: headers(),
    });
    const body = res.json() as Record<string, unknown>;

    expect(res.statusCode).toBe(200);
    expect(body.status).toBe('schema_pending');
    expect(body.prospects).toEqual([]);
  });

  it('enqueues nothing and says why', async () => {
    const res = await app(dbWithoutTables()).inject({
      method: 'POST',
      url: '/v1/demos/enqueue',
      headers: headers(),
      payload: { leadId: LEAD },
    });
    const body = res.json() as Record<string, unknown>;

    expect(body.status).toBe('schema_pending');
    expect(body.enqueued).toBe(false);
  });

  /** A real fault must still be a fault. */
  it('does not swallow an unrelated database error', async () => {
    const db = new FakeDb();
    db.when(/from leads where lead_id/i, [{ lead_id: LEAD, status: 'new' }]);
    db.when(/insert into qualification_assessments/i, () => {
      throw new Error('connection terminated');
    });
    const { statusCode } = await qualify(db);
    expect(statusCode).toBe(500);
  });
});

/**
 * leads.record (docs/specs/p2/revenue-pilot.md).
 *
 * `leads.find` needs an approved directory adapter and has none, so without
 * this there is no way to get a prospect into the pilot: every P2C surface
 * keys off a lead and nothing could create one.
 */
describe('leads.record', () => {
  function db(existing: Array<Record<string, unknown>> = []): FakeDb {
    const d = new FakeDb();
    d.when(/from leads where space_id = \$1 and lower\(business_name\)/i, existing);
    d.when(/insert into leads/i, [{ lead_id: 'lead-new' }]);
    return d;
  }

  async function record(d: FakeDb, payload: Record<string, unknown>) {
    const res = await app(d).inject({
      method: 'POST',
      url: '/v1/leads/record',
      headers: headers(),
      payload,
    });
    return { statusCode: res.statusCode, body: res.json() as Record<string, unknown> };
  }

  it('records a hand-sourced prospect with its provenance', async () => {
    const d = db();
    const { body } = await record(d, {
      businessName: 'Acme Plumbing',
      sourceUrl: 'https://maps.example/acme',
      phone: '555-0100',
    });

    expect(body).toMatchObject({ recorded: true, leadId: 'lead-new', status: 'new' });
    const insert = d.calls.find((c) => /insert into leads/i.test(c.sql));
    expect(insert?.params).toContain('Acme Plumbing');
    // Provenance is stored with the row that will be qualified against it.
    expect(String(insert?.params?.[4])).toContain('https://maps.example/acme');
  });

  /**
   * An unsourced prospect could never pass the rubric's contact-source check.
   * The registry declares `sourceUrl` required, so the route's input schema
   * refuses it before the handler is reached — the handler keeps its own guard
   * as defence in depth, but this is where it is actually stopped.
   */
  it('refuses a prospect with no recorded source, and records nothing', async () => {
    const d = db();
    const { statusCode } = await record(d, { businessName: 'Acme Plumbing' });
    expect(statusCode).toBe(400);
    expect(d.calls.some((c) => /insert into leads/i.test(c.sql))).toBe(false);
  });

  it('requires a business name', async () => {
    const { statusCode } = await record(db(), { sourceUrl: 'https://maps.example/acme' });
    expect(statusCode).toBe(400);
  });

  /**
   * Two rows for one business would put two prospects in the funnel and let
   * both be contacted; the rubric disqualifies duplicates for the same reason.
   */
  it('refuses a business already recorded in the space, and names the existing one', async () => {
    const d = db([{ lead_id: 'lead-existing' }]);
    const { body } = await record(d, {
      businessName: 'Acme Plumbing',
      sourceUrl: 'https://maps.example/acme',
    });

    expect(body).toMatchObject({
      recorded: false,
      code: 'already_recorded',
      duplicateOf: 'lead-existing',
    });
    expect(d.calls.some((c) => /insert into leads/i.test(c.sql))).toBe(false);
  });

  /** leads.status carries suppression; a recorder must not be able to set it. */
  it('always records the lifecycle as new, whatever the caller sends', async () => {
    const d = db();
    await record(d, {
      businessName: 'Acme Plumbing',
      sourceUrl: 'https://maps.example/acme',
      status: 'suppressed',
    });

    const insert = d.calls.find((c) => /insert into leads/i.test(c.sql));
    expect(insert?.sql).toMatch(/'new'/);
    expect(insert?.params).not.toContain('suppressed');
  });

  it('audits what was recorded', async () => {
    const d = db();
    await record(d, { businessName: 'Acme Plumbing', sourceUrl: 'https://maps.example/acme' });
    expect(d.auditInserts().some((a) => (a.params ?? []).includes('leads.recorded'))).toBe(true);
  });

  it('audits a refused duplicate too', async () => {
    const d = db([{ lead_id: 'lead-existing' }]);
    await record(d, { businessName: 'Acme Plumbing', sourceUrl: 'https://maps.example/acme' });
    expect(d.auditInserts().some((a) => (a.params ?? []).includes('leads.record_refused'))).toBe(true);
  });
});
