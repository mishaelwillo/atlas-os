/**
 * How runs.execute executes a target capability.
 *
 * The defect this pins: every non-approval capability used to go to the model
 * router, so a scheduled deterministic check recorded a `succeeded` run
 * carrying a model's prose about work that never happened. The registry now
 * declares which capabilities do real work in their own code.
 */
import { describe, expect, it } from 'vitest';
import { registry } from '@atlas/registry';
import { buildApp } from './app.js';
import { FakeDb, buildTestDeps, operatorJwt, testEnv } from './test/fakes.js';
import { handlers } from './handlers/index.js';

const SPACE = '11111111-2222-3333-4444-555555555555';

function headers() {
  return { authorization: `Bearer ${operatorJwt(testEnv())}`, 'x-atlas-space': SPACE };
}

function dbForRun(): FakeDb {
  const db = new FakeDb();
  db.when(/insert into runs/i, [{ run_id: 'run-1' }]);
  return db;
}

async function execute(db: FakeDb, capability: string, input: Record<string, unknown> = {}) {
  const res = await buildApp({ deps: buildTestDeps(db) }).inject({
    method: 'POST',
    url: '/v1/runs/execute',
    headers: headers(),
    payload: { capability, input },
  });
  return { statusCode: res.statusCode, body: res.json() as Record<string, unknown> };
}

describe('the registry declares how every capability executes', () => {
  it('leaves none undeclared', () => {
    for (const cap of registry) {
      expect(['handler', 'model']).toContain(cap.execution);
    }
  });

  /**
   * A capability that does real work must not be answered by a model. Only the
   * two token-ladder capabilities are genuinely model-answered.
   */
  it('marks only the model-answered capabilities as model', () => {
    const model = registry.filter((c) => c.execution === 'model').map((c) => c.id).sort();
    expect(model).toEqual(['memory.answer', 'memory.distill']);
  });

  /**
   * The handler map claims completeness in its own header comment and nothing
   * asserted it, which is how two approval-gated capabilities were added
   * without entries.
   */
  it('has a handler entry for every capability', () => {
    const missing = registry.filter((c) => !handlers[c.id]).map((c) => c.id);
    expect(missing).toEqual([]);
  });

  /**
   * Approval-gated capabilities never reach a handler — the gate short-circuits
   * and dispatch.ts executes them — so the invariant that matters is about the
   * ones a run actually invokes.
   */
  it('runs a real handler for every non-approval capability that declares one', () => {
    for (const cap of registry.filter((c) => c.execution === 'handler' && !c.requiresApproval)) {
      expect(handlers[cap.id]).toBeTypeOf('function');
    }
  });
});

describe('running a deterministic capability', () => {
  /** The whole point: the capability's own code runs, not a prompt about it. */
  it('invokes the handler and records the run as answered by it', async () => {
    const db = dbForRun();
    db.when(/from site_deployments\s+where status = 'live'/i, []);
    const { body } = await execute(db, 'factory.verify_live');

    expect(body).toMatchObject({ runId: 'run-1', status: 'succeeded' });
    const update = db.calls.find((c) => /update runs set status = 'succeeded'/i.test(c.sql));
    expect(update?.sql).toMatch(/answered_by = 'handler'/);
  });

  it('records the handler output, not a model answer', async () => {
    const db = dbForRun();
    db.when(/from site_deployments\s+where status = 'live'/i, []);
    await execute(db, 'factory.verify_live');

    const update = db.calls.find((c) => /update runs set status = 'succeeded'/i.test(c.sql));
    const output = JSON.parse(String(update?.params?.[1])) as Record<string, unknown>;
    expect(output).toMatchObject({ checked: 0, healthy: true });
  });

  /** No model was called, so no tokens or cost may be recorded against it. */
  it('spends nothing', async () => {
    const db = dbForRun();
    db.when(/from site_deployments\s+where status = 'live'/i, []);
    await execute(db, 'factory.verify_live');

    const update = db.calls.find((c) => /update runs set status = 'succeeded'/i.test(c.sql));
    expect(update?.sql).not.toMatch(/tokens_in|cost_usd|model_used/);
  });

  /**
   * A typed stub that throws is a failed run. Previously it would have been a
   * succeeded run containing a model's description of the unimplemented thing.
   */
  it('fails the run when the handler refuses', async () => {
    const db = dbForRun();
    const { body } = await execute(db, 'leads.find', { industry: 'plumbing', location: 'x' });

    expect(body).toMatchObject({ runId: 'run-1', status: 'failed' });
    const update = db.calls.find((c) => /update runs set status = 'failed'/i.test(c.sql));
    expect(String(update?.params?.[1])).toMatch(/not implemented/i);
    expect(db.calls.some((c) => /insert into run_logs/i.test(c.sql))).toBe(true);
  });
});

describe('running a model-answered capability', () => {
  it('still routes to the model and records the rung', async () => {
    const db = dbForRun();
    const { body } = await execute(db, 'memory.answer', { query: 'what is live?' });

    expect(body).toMatchObject({ status: 'succeeded' });
    const update = db.calls.find((c) => /update runs set status = 'succeeded'/i.test(c.sql));
    expect(update?.sql).toMatch(/answered_by = 'model'/);
    expect(update?.sql).toMatch(/model_used/);
  });
});

describe('approval-gated targets', () => {
  /** The gate short-circuits before either execution path. */
  it('are held rather than executed', async () => {
    const db = dbForRun();
    db.when(/insert into approvals/i, [{ approval_id: 'appr-1' }]);
    const { body } = await execute(db, 'outreach.send', { leadId: 'x', channel: 'email', body: 'hi' });

    expect(body).toMatchObject({ status: 'review' });
    expect(db.calls.some((c) => /update runs set status = 'succeeded'/i.test(c.sql))).toBe(false);
  });
});
