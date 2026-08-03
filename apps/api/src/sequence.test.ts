/**
 * Outreach sequences through the pipeline (docs/specs/p2/revenue-pilot.md).
 *
 * The rules are tested as pure functions elsewhere. What matters here is the
 * one property that only holds end to end: a sequence cannot put a touch into
 * `sent`, and the approval-gated `outreach.send` dispatch is the only thing
 * that can.
 */
import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { FakeDb, buildTestDeps, operatorJwt, testEnv } from './test/fakes.js';

const SPACE = '11111111-2222-3333-4444-555555555555';
const LEAD = '99999999-8888-7777-6666-555555555555';
const APPROVAL = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const TOUCH = 'cccccccc-dddd-eeee-ffff-000000000000';

class UndefinedTable extends Error {
  readonly code = '42P01';
}

function headers() {
  return { authorization: `Bearer ${operatorJwt(testEnv())}`, 'x-atlas-space': SPACE };
}

function app(db: FakeDb) {
  return buildApp({ deps: buildTestDeps(db) });
}

function dbWithLead(status = 'new'): FakeDb {
  const db = new FakeDb();
  db.when(/from leads where lead_id/i, [{ lead_id: LEAD, status }]);
  db.when(/from outreach_sequences\s+where lead_id = \$1 and state in/i, []);
  db.when(/coalesce\(max\(version\), 0\) \+ 1/i, [{ next: 1 }]);
  db.when(/insert into outreach_sequences/i, [{ sequence_id: 'seq-1' }]);
  return db;
}

async function plan(db: FakeDb, channels: unknown[]) {
  const res = await app(db).inject({
    method: 'POST',
    url: '/v1/automation/sequence',
    headers: headers(),
    payload: { leadId: LEAD, channels },
  });
  return res.json() as Record<string, unknown>;
}

describe('automation.sequence', () => {
  it('plans touches as drafts and nothing further', async () => {
    const db = dbWithLead();
    const body = await plan(db, ['email', 'sms']);

    expect(body).toMatchObject({ planned: true, sequenceId: 'seq-1', state: 'planned' });
    const inserts = db.calls.filter((c) => /insert into outreach_touches/i.test(c.sql));
    expect(inserts).toHaveLength(2);
    // Every touch starts as a draft; none is scheduled, approved or sent.
    expect(inserts.every((i) => /'draft'/.test(i.sql))).toBe(true);
  });

  /** A plan for someone who asked us to stop must fail here, not at send time. */
  it('refuses to sequence a suppressed lead', async () => {
    const db = dbWithLead('suppressed');
    const body = await plan(db, ['email']);

    expect(body).toMatchObject({ planned: false, code: 'lead_suppressed' });
    expect(db.calls.some((c) => /insert into outreach_sequences/i.test(c.sql))).toBe(false);
  });

  it('refuses a repeated channel and writes nothing', async () => {
    const db = dbWithLead();
    const body = await plan(db, ['email', 'email']);

    expect(body).toMatchObject({ planned: false, code: 'repeated_channel' });
    expect(db.calls.some((c) => /insert into outreach_sequences/i.test(c.sql))).toBe(false);
  });

  it('refuses a second sequence while one is open', async () => {
    // Built without the helper: FakeDb answers with the first matching
    // responder, so the helper's empty one could not be overridden here.
    const db = new FakeDb();
    db.when(/from leads where lead_id/i, [{ lead_id: LEAD, status: 'new' }]);
    db.when(/from outreach_sequences\s+where lead_id = \$1 and state in/i, [
      { sequence_id: 'seq-0' },
    ]);
    const body = await plan(db, ['email']);

    expect(body).toMatchObject({ planned: false, code: 'sequence_already_open' });
    expect(db.calls.some((c) => /insert into outreach_sequences/i.test(c.sql))).toBe(false);
  });

  it('audits a planned sequence', async () => {
    const db = dbWithLead();
    await plan(db, ['email']);
    expect(
      db.auditInserts().some((a) => (a.params ?? []).includes('automation.sequence_planned')),
    ).toBe(true);
  });

  it('reports an unknown lead', async () => {
    const res = await app(new FakeDb()).inject({
      method: 'POST',
      url: '/v1/automation/sequence',
      headers: headers(),
      payload: { leadId: LEAD, channels: ['email'] },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('sequence.advance', () => {
  function dbWithTouch(state: string, sequenceState = 'active', approved = true): FakeDb {
    const db = new FakeDb();
    db.when(/from outreach_touches t\s+join outreach_sequences/i, [
      { touch_id: TOUCH, sequence_id: 'seq-1', state, step: 1, sequence_state: sequenceState },
    ]);
    db.when(/from approvals where approval_id/i, approved ? [{ approval_id: APPROVAL }] : []);
    db.when(/from outreach_touches\s+where sequence_id/i, [
      { touch_id: TOUCH, step: 1, channel: 'email', state, sent_at: null },
    ]);
    return db;
  }

  async function advance(db: FakeDb, to: string, approvalId?: string) {
    const res = await app(db).inject({
      method: 'POST',
      url: '/v1/sequence/advance',
      headers: headers(),
      payload: { touchId: TOUCH, state: to, ...(approvalId ? { approvalId } : {}) },
    });
    return res.json() as Record<string, unknown>;
  }

  it('moves a touch one declared step', async () => {
    const db = dbWithTouch('draft');
    const body = await advance(db, 'policy_check');

    expect(body).toMatchObject({ advanced: true, from: 'draft', to: 'policy_check' });
    expect(db.calls.some((c) => /update outreach_touches/i.test(c.sql))).toBe(true);
  });

  /**
   * The invariant the whole design turns on: a sequence cannot record a send.
   * If it could, the audit trail would claim an external effect that no
   * approved dispatch performed.
   */
  it('refuses to mark a touch sent, and changes nothing', async () => {
    const db = dbWithTouch('scheduled');
    const body = await advance(db, 'sent');

    expect(body).toMatchObject({ advanced: false, code: 'send_not_self_serviceable' });
    expect(db.calls.some((c) => /update outreach_touches/i.test(c.sql))).toBe(false);
  });

  it('approves a touch against a real approved approval', async () => {
    const db = dbWithTouch('approval_required');
    expect(await advance(db, 'approved', APPROVAL)).toMatchObject({ advanced: true, to: 'approved' });
  });

  /** An approval reference that is not an approved row is not an approval. */
  it('refuses to approve against an approval id that does not resolve', async () => {
    const db = dbWithTouch('approval_required', 'active', false);
    expect(await advance(db, 'approved', APPROVAL)).toMatchObject({
      advanced: false,
      code: 'approval_required',
    });
  });

  it('refuses to approve with no approval at all', async () => {
    expect(await advance(dbWithTouch('approval_required'), 'approved')).toMatchObject({
      advanced: false,
      code: 'approval_required',
    });
  });

  it('stops the sequence on a reply', async () => {
    const db = new FakeDb();
    db.when(/from outreach_touches t\s+join outreach_sequences/i, [
      { touch_id: TOUCH, sequence_id: 'seq-1', state: 'delivered', step: 1, sequence_state: 'active' },
    ]);
    db.when(/from outreach_touches\s+where sequence_id/i, [
      { touch_id: TOUCH, step: 1, channel: 'email', state: 'replied', sent_at: null },
    ]);
    const body = await advance(db, 'replied');

    expect(body).toMatchObject({ advanced: true, stopped: true, sequenceState: 'stopped' });
    const update = db.calls.find((c) => /update outreach_sequences/i.test(c.sql));
    expect((update?.params ?? []).includes('stopped')).toBe(true);
  });

  it('refuses every move once the sequence has stopped', async () => {
    const db = dbWithTouch('draft', 'stopped');
    expect(await advance(db, 'policy_check')).toMatchObject({
      advanced: false,
      code: 'sequence_stopped',
    });
  });

  it('audits a refusal', async () => {
    const db = dbWithTouch('scheduled');
    await advance(db, 'sent');
    expect(
      db.auditInserts().some((a) => (a.params ?? []).includes('sequence.advance_refused')),
    ).toBe(true);
  });
});

/**
 * The other half of the invariant: the approved dispatch — and only it — may
 * record the send.
 */
describe('outreach.send dispatch records the touch', () => {
  function dbForDispatch(touchState: string): FakeDb {
    const db = new FakeDb();
    db.when(/from approvals where approval_id/i, [
      {
        approval_id: APPROVAL,
        space_id: SPACE,
        run_id: null,
        kind: 'outreach.send',
        payload: { input: { leadId: LEAD, channel: 'email', body: 'hello', touchId: TOUCH } },
      },
    ]);
    db.when(/from outreach_touches t\s+join outreach_sequences/i, [
      { touch_id: TOUCH, state: touchState, sequence_state: 'active' },
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

  it('marks a scheduled touch as sent', async () => {
    const db = dbForDispatch('scheduled');
    const dispatched = await decide(db);

    expect(dispatched.touchRecorded).toBe(true);
    const update = db.calls.find((c) => /update outreach_touches set state = 'sent'/i.test(c.sql));
    expect(update).toBeDefined();
  });

  /** A touch that never reached `scheduled` is left alone, not dragged forward. */
  it('leaves a touch that was never scheduled alone', async () => {
    const db = dbForDispatch('draft');
    const dispatched = await decide(db);

    expect(dispatched.touchRecorded).toBe(false);
    expect(db.calls.some((c) => /update outreach_touches set state = 'sent'/i.test(c.sql))).toBe(
      false,
    );
  });

  it('still dispatches when no touch is named', async () => {
    const db = new FakeDb();
    db.when(/from approvals where approval_id/i, [
      {
        approval_id: APPROVAL,
        space_id: SPACE,
        run_id: null,
        kind: 'outreach.send',
        payload: { input: { leadId: LEAD, channel: 'email', body: 'hello' } },
      },
    ]);
    const dispatched = await decide(db);

    expect(dispatched.executed).toBe(true);
    expect(dispatched.touchRecorded).toBeNull();
  });

  /** The dispatch stands even when sequence state cannot be recorded. */
  it('reports the pending schema without failing the dispatch', async () => {
    const db = new FakeDb();
    db.when(/from approvals where approval_id/i, [
      {
        approval_id: APPROVAL,
        space_id: SPACE,
        run_id: null,
        kind: 'outreach.send',
        payload: { input: { leadId: LEAD, channel: 'email', body: 'hello', touchId: TOUCH } },
      },
    ]);
    db.when(/outreach_touches/i, () => {
      throw new UndefinedTable('relation does not exist');
    });
    const dispatched = await decide(db);

    expect(dispatched.executed).toBe(true);
    expect(dispatched.touchRecorded).toBe(false);
    expect(String(dispatched.touchNote)).toContain('0005_outreach_sequences');
  });
});

describe('before migration 0005 is applied', () => {
  function dbWithoutTables(): FakeDb {
    const db = new FakeDb();
    db.when(/from leads where lead_id/i, [{ lead_id: LEAD, status: 'new' }]);
    db.when(/outreach_sequences|outreach_touches/i, () => {
      throw new UndefinedTable('relation does not exist');
    });
    return db;
  }

  it('plans nothing and says why', async () => {
    const body = await plan(dbWithoutTables(), ['email']);
    expect(body.status).toBe('schema_pending');
    expect(String(body.note)).toContain('0005_outreach_sequences');
    expect(body.planned).toBe(false);
  });

  it('reports the pending schema from sequence.state', async () => {
    const res = await app(dbWithoutTables()).inject({
      method: 'GET',
      url: `/v1/sequence/state?leadId=${LEAD}`,
      headers: headers(),
    });
    const body = res.json() as Record<string, unknown>;
    expect(body.status).toBe('schema_pending');
    expect(body.found).toBe(false);
  });

  /** A real fault must still be a fault. */
  it('does not swallow an unrelated database error', async () => {
    const db = new FakeDb();
    db.when(/from leads where lead_id/i, [{ lead_id: LEAD, status: 'new' }]);
    db.when(/outreach_sequences/i, () => {
      throw new Error('connection terminated');
    });
    const res = await app(db).inject({
      method: 'POST',
      url: '/v1/automation/sequence',
      headers: headers(),
      payload: { leadId: LEAD, channels: ['email'] },
    });
    expect(res.statusCode).toBe(500);
  });
});
