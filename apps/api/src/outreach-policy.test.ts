/**
 * Outreach policy through the route pipeline.
 *
 * The registry has described outreach.send as "daily cap enforced" since P1
 * while nothing enforced it. These tests hold that claim true, and hold the
 * ordering the spec requires: policy_check precedes approval_required, so a
 * refused touch never reaches the approval queue.
 */
import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { FakeDb, buildTestDeps, operatorJwt, testEnv } from './test/fakes.js';

const SPACE = '11111111-2222-3333-4444-555555555555';
const LEAD = '22222222-3333-4444-5555-666666666666';

function appWith(db: FakeDb, cap = 10): FastifyInstance {
  return buildApp({ deps: buildTestDeps(db, { ...testEnv(), outreachDailyCap: cap }) });
}

/** A db whose lead lookup and touch count are set per case. */
function dbWith(leadStatus: string | null, touchesToday: number): FakeDb {
  const db = new FakeDb();
  db.when(/from leads where lead_id/i, leadStatus === null ? [] : [{ status: leadStatus }]);
  db.when(/count\(\*\)::int as n from approvals/i, [{ n: touchesToday }]);
  db.when(/insert into approvals/i, [{ approval_id: 'approval-1' }]);
  return db;
}

async function draft(db: FakeDb, cap = 10, leadId: string = LEAD) {
  const res = await appWith(db, cap).inject({
    method: 'POST',
    url: '/v1/outreach/send',
    headers: {
      authorization: `Bearer ${operatorJwt(testEnv())}`,
      'x-atlas-space': SPACE,
    },
    payload: { leadId, channel: 'email', body: 'hello' },
  });
  return { status: res.statusCode, body: res.json() as Record<string, unknown> };
}

function approvalInsert(db: FakeDb) {
  return db.calls.find((c) => /insert into approvals/i.test(c.sql));
}

describe('outreach policy gate', () => {
  it('queues an approval for an engageable lead', async () => {
    const db = dbWith('new', 0);
    const { status, body } = await draft(db);

    expect(status).toBe(200);
    expect(body.approvalId).toBe('approval-1');
    expect(body.status).toBe('review');
  });

  /** The refusal must happen before the queue, not inside it. */
  it('refuses a suppressed lead and creates no approval', async () => {
    const db = dbWith('suppressed', 0);
    const { status, body } = await draft(db);

    expect(status).toBe(409);
    expect(body.code).toBe('lead_suppressed');
    expect(approvalInsert(db)).toBeUndefined();
  });

  it('refuses once the daily cap is reached and creates no approval', async () => {
    const db = dbWith('new', 10);
    const { status, body } = await draft(db, 10);

    expect(status).toBe(409);
    expect(body.code).toBe('daily_cap_reached');
    expect(approvalInsert(db)).toBeUndefined();
  });

  it('permits the touch that sits just below the cap', async () => {
    const db = dbWith('new', 9);
    expect((await draft(db, 10)).status).toBe(200);
  });

  /** Hand-entered references are the only workflow until sourcing exists. */
  it('permits an unknown lead reference but still counts it', async () => {
    const db = dbWith(null, 0);
    const { status } = await draft(db, 10, 'hand-sourced-prospect');

    expect(status).toBe(200);
    // A non-uuid reference cannot match a row, so no lookup is attempted.
    expect(db.calls.some((c) => /from leads where lead_id/i.test(c.sql))).toBe(false);
  });

  it('caps an unknown lead reference too', async () => {
    const db = dbWith(null, 10);
    expect((await draft(db, 10, 'hand-sourced-prospect')).status).toBe(409);
  });

  it('audits a refusal so a blocked touch is not invisible', async () => {
    const db = dbWith('suppressed', 0);
    await draft(db);

    const audits = db.auditInserts();
    expect(audits.some((a) => (a.params ?? []).includes('outreach.send.refused'))).toBe(true);
  });

  it('does not count rejected drafts against the cap', async () => {
    const db = dbWith('new', 0);
    await draft(db);
    const counted = db.calls.find((c) => /count\(\*\)::int as n from approvals/i.test(c.sql));
    expect(counted?.sql).toMatch(/status <> 'rejected'/);
  });

  it('counts only touches from the current day', async () => {
    const db = dbWith('new', 0);
    await draft(db);
    const counted = db.calls.find((c) => /count\(\*\)::int as n from approvals/i.test(c.sql));
    expect(counted?.sql).toMatch(/date_trunc\('day', now\(\)\)/);
  });

  /** Other approval-gated capabilities must be unaffected. */
  it('leaves an unrelated approval-gated capability alone', async () => {
    const db = new FakeDb();
    db.when(/insert into approvals/i, [{ approval_id: 'approval-2' }]);
    const res = await appWith(db).inject({
      method: 'POST',
      url: '/v1/factory/deploy_site',
      headers: {
        authorization: `Bearer ${operatorJwt(testEnv())}`,
        'x-atlas-space': SPACE,
      },
      payload: { siteId: 'site-1' },
    });

    expect(res.statusCode).toBe(200);
    expect(db.calls.some((c) => /from leads where lead_id/i.test(c.sql))).toBe(false);
  });
});
