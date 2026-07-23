/**
 * Pipeline security tests (brief §6): token auth + scope rejection, RLS space
 * scoping (set_config via withSpace), approval-gate flow (requiresApproval
 * capability NEVER executes without a decision), audit row on every route.
 */
import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { sha256hex } from './auth.js';
import { FakeDb, buildTestDeps, operatorJwt, registerToken, testEnv } from './test/fakes.js';

const TOKEN_PLAINTEXT = 'atlas_test_token_abc123';
const SPACE = '11111111-2222-3333-4444-555555555555';

function appWith(db: FakeDb): FastifyInstance {
  return buildApp({ deps: buildTestDeps(db) });
}

describe('auth', () => {
  it('rejects requests without a bearer token (401)', async () => {
    const app = appWith(new FakeDb());
    const res = await app.inject({ method: 'GET', url: '/v1/status/mission_control' });
    expect(res.statusCode).toBe(401);
  });

  it('rejects unknown tokens (401)', async () => {
    const app = appWith(new FakeDb());
    const res = await app.inject({
      method: 'GET',
      url: '/v1/approvals/list',
      headers: { authorization: 'Bearer nope' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a JWT whose email is not the pinned operator (403)', async () => {
    const db = new FakeDb();
    const app = appWith(db);
    const jwt = operatorJwt(testEnv(), 'intruder@evil.example');
    const res = await app.inject({ method: 'GET', url: '/v1/approvals/list', headers: { authorization: `Bearer ${jwt}` } });
    expect(res.statusCode).toBe(403);
  });

  it('rejects a token lacking the required scope (403) and writes no audit row', async () => {
    const db = new FakeDb();
    registerToken(db, { spaceId: SPACE, label: 'reader', scopes: ['memory:read'], hash: sha256hex(TOKEN_PLAINTEXT) });
    const app = appWith(db);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/memory/ingest', // needs memory:write
      headers: { authorization: `Bearer ${TOKEN_PLAINTEXT}` },
      payload: { cards: [] },
    });
    expect(res.statusCode).toBe(403);
    expect(db.auditInserts()).toHaveLength(0);
  });

  it('rejects tokens on operator-only capabilities (empty scopes)', async () => {
    const db = new FakeDb();
    registerToken(db, { spaceId: SPACE, label: 'writer', scopes: ['memory:write'], hash: sha256hex(TOKEN_PLAINTEXT) });
    const app = appWith(db);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/approvals/decide',
      headers: { authorization: `Bearer ${TOKEN_PLAINTEXT}` },
      payload: { approvalId: 'x', decision: 'approved' },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('RLS space scoping', () => {
  it("runs the request inside a tx scoped to the token's space", async () => {
    const db = new FakeDb();
    registerToken(db, { spaceId: SPACE, label: 'agent', scopes: ['memory:write'], hash: sha256hex(TOKEN_PLAINTEXT) });
    const app = appWith(db);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/memory/ingest',
      headers: { authorization: `Bearer ${TOKEN_PLAINTEXT}` },
      payload: { cards: [{ title: 't', body: 'b', source: 'drive:/x.md' }] },
    });
    expect(res.statusCode).toBe(200);
    expect(db.spaceLog).toContain(SPACE);
    // every scoped query in the handler ran inside that space's tx
    const cardInsert = db.calls.find((c) => c.sql.includes('insert into memory_cards'));
    expect(cardInsert?.space).toBe(SPACE);
  });
});

describe('audit trail', () => {
  it('every capability call inserts an audit_log row with the actor', async () => {
    const db = new FakeDb();
    registerToken(db, { spaceId: SPACE, label: 'agent', scopes: ['memory:write'], hash: sha256hex(TOKEN_PLAINTEXT) });
    const app = appWith(db);
    await app.inject({
      method: 'POST',
      url: '/v1/memory/ingest',
      headers: { authorization: `Bearer ${TOKEN_PLAINTEXT}` },
      payload: { cards: [] },
    });
    const audits = db.auditInserts();
    expect(audits).toHaveLength(1);
    expect(audits[0].params).toContain('token:agent');
    expect(audits[0].params).toContain('memory.ingest');
  });

  it('GET routes are audited too', async () => {
    const db = new FakeDb();
    const app = appWith(db);
    const jwt = operatorJwt(testEnv());
    const res = await app.inject({ method: 'GET', url: '/v1/approvals/list', headers: { authorization: `Bearer ${jwt}` } });
    expect(res.statusCode).toBe(200);
    expect(db.auditInserts()).toHaveLength(1);
  });
});

describe('approval gate (SECURITY.md inv. 1/4)', () => {
  it('outreach.send returns {approvalId, status:review} and never executes', async () => {
    const db = new FakeDb();
    db.when(/insert into approvals/, [{ approval_id: 'ap-42' }]);
    const app = appWith(db);
    const jwt = operatorJwt(testEnv());
    const res = await app.inject({
      method: 'POST',
      url: '/v1/outreach/send',
      headers: { authorization: `Bearer ${jwt}`, 'x-atlas-space': SPACE },
      payload: { leadId: 'l1', channel: 'email', body: 'hello' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ approvalId: 'ap-42', status: 'review' });
    // held action must NOT have executed: no message insert, no dispatch audit
    expect(db.calls.some((c) => c.sql.includes('insert into messages'))).toBe(false);
    expect(db.calls.some((c) => c.sql.includes('insert into approvals'))).toBe(true);
  });

  it('runs.execute holds approval-gated target capabilities too', async () => {
    const db = new FakeDb();
    registerToken(db, { spaceId: SPACE, label: 'agent', scopes: ['runs:write'], hash: sha256hex(TOKEN_PLAINTEXT) });
    db.when(/insert into approvals/, [{ approval_id: 'ap-7' }]);
    db.when(/insert into runs/, [{ run_id: 'run-7' }]);
    const app = appWith(db);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/runs/execute',
      headers: { authorization: `Bearer ${TOKEN_PLAINTEXT}` },
      payload: { capability: 'outreach.send', input: { leadId: 'l1', channel: 'sms', body: 'yo' } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ runId: 'run-7', status: 'review' });
  });

  it('approvals.decide (operator) dispatches the held outreach as log-only stub', async () => {
    const db = new FakeDb();
    db.when(/select approval_id, space_id, run_id, kind, payload from approvals/, [
      {
        approval_id: 'ap-42',
        space_id: SPACE,
        run_id: null,
        kind: 'outreach.send',
        payload: { capability: 'outreach.send', input: { leadId: 'l1', channel: 'email', body: 'hello' } },
      },
    ]);
    const app = appWith(db);
    const jwt = operatorJwt(testEnv());
    const res = await app.inject({
      method: 'POST',
      url: '/v1/approvals/decide',
      headers: { authorization: `Bearer ${jwt}`, 'x-atlas-space': SPACE },
      payload: { approvalId: 'ap-42', decision: 'approved', notes: 'lgtm' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { dispatched: { stub: boolean } };
    expect(body.dispatched.stub).toBe(true);
    // dispatcher audit fired, and still no outbound message row
    expect(db.calls.some((c) => c.sql.includes('insert into audit_log') && c.params?.includes('outreach.dispatched'))).toBe(true);
    expect(db.calls.some((c) => c.sql.includes('insert into messages'))).toBe(false);
  });
});

describe('input validation', () => {
  it('rejects schema-invalid input with 400 before any handler work', async () => {
    const db = new FakeDb();
    registerToken(db, { spaceId: SPACE, label: 'agent', scopes: ['memory:write'], hash: sha256hex(TOKEN_PLAINTEXT) });
    const app = appWith(db);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/memory/ingest',
      headers: { authorization: `Bearer ${TOKEN_PLAINTEXT}` },
      payload: { nope: true }, // missing required 'cards'
    });
    expect(res.statusCode).toBe(400);
    expect(db.calls.some((c) => c.sql.includes('insert into memory_cards'))).toBe(false);
  });
});
