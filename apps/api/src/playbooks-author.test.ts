/**
 * playbooks.author execution under approval (docs/specs/p2/intelligence-foundation.md).
 * The capability is approval-gated, so authoring must happen only from
 * approvals.decide and must never mutate an existing version.
 */
import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { playbookSlug } from './dispatch.js';
import { FakeDb, buildTestDeps, operatorJwt, testEnv } from './test/fakes.js';

const SPACE = '11111111-2222-3333-4444-555555555555';
const APPROVAL = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function appWith(db: FakeDb): FastifyInstance {
  return buildApp({ deps: buildTestDeps(db) });
}

/** A pending playbooks.author approval carrying the given capability input. */
function dbWithPendingApproval(input: Record<string, unknown>, version = 1): FakeDb {
  const db = new FakeDb();
  db.when(/from approvals where approval_id/i, [
    {
      approval_id: APPROVAL,
      space_id: SPACE,
      run_id: null,
      kind: 'playbooks.author',
      payload: { input },
    },
  ]);
  db.when(/insert into playbooks/i, [{ playbook_id: 'pb-1', version }]);
  return db;
}

async function decide(db: FakeDb) {
  const res = await appWith(db).inject({
    method: 'POST',
    url: '/v1/approvals/decide',
    headers: { authorization: `Bearer ${operatorJwt(testEnv())}` },
    payload: { approvalId: APPROVAL, decision: 'approved' },
  });
  return { status: res.statusCode, body: res.json() };
}

function playbookInsert(db: FakeDb) {
  return db.calls.find((c) => /insert into playbooks/i.test(c.sql));
}

describe('playbook slug', () => {
  it('collapses a task family into a stable lineage key', () => {
    expect(playbookSlug('listing-classify')).toBe('listing-classify');
    expect(playbookSlug('  Site Descriptor  ')).toBe('site-descriptor');
    expect(playbookSlug('audit/fix_v2')).toBe('audit-fix-v2');
  });

  it('yields an empty slug when nothing usable remains', () => {
    expect(playbookSlug('///')).toBe('');
  });
});

describe('playbooks.author under approval', () => {
  it('persists a new version and reports it', async () => {
    const db = dbWithPendingApproval({ taskFamily: 'listing-classify', brief: 'Classify listings.' }, 3);
    const { status, body } = await decide(db);

    expect(status).toBe(200);
    const dispatched = body.dispatched as Record<string, unknown>;
    expect(dispatched.executed).toBe(true);
    expect(dispatched.playbookId).toBe('pb-1');
    expect(dispatched.version).toBe(3);
    expect(dispatched.slug).toBe('listing-classify');
    // Ordering, not mutation, is what supersedes a prior version.
    expect(dispatched.supersedes).toBe(2);
  });

  it('reports no supersession for a first version', async () => {
    const db = dbWithPendingApproval({ taskFamily: 'audit-fix', brief: 'Fix audits.' }, 1);
    const { body } = await decide(db);
    expect((body.dispatched as Record<string, unknown>).supersedes).toBeNull();
  });

  /** An empty playbook would read as an approved deliverable that isn't there. */
  it('refuses to author when no brief was supplied', async () => {
    const db = dbWithPendingApproval({ taskFamily: 'listing-classify' });
    const { body } = await decide(db);

    const dispatched = body.dispatched as Record<string, unknown>;
    expect(dispatched.executed).toBe(false);
    expect(String(dispatched.note)).toMatch(/nothing to author/);
    expect(playbookInsert(db)).toBeUndefined();
  });

  it('refuses a task family with no usable slug', async () => {
    const db = dbWithPendingApproval({ taskFamily: '///', brief: 'something' });
    const { body } = await decide(db);
    expect((body.dispatched as Record<string, unknown>).executed).toBe(false);
    expect(playbookInsert(db)).toBeUndefined();
  });

  it('refuses a missing task family', async () => {
    const db = dbWithPendingApproval({ brief: 'orphan brief' });
    const { body } = await decide(db);
    expect((body.dispatched as Record<string, unknown>).executed).toBe(false);
    expect(playbookInsert(db)).toBeUndefined();
  });

  /** Immutability: authoring may insert, never update. */
  it('never updates an existing playbook row', async () => {
    const db = dbWithPendingApproval({ taskFamily: 'listing-classify', brief: 'Classify.' });
    await decide(db);
    expect(db.calls.some((c) => /update\s+playbooks/i.test(c.sql))).toBe(false);
  });

  it('derives the next version inside the insert rather than reading it first', async () => {
    const db = dbWithPendingApproval({ taskFamily: 'listing-classify', brief: 'Classify.' });
    await decide(db);
    const sql = playbookInsert(db)?.sql ?? '';
    expect(sql).toMatch(/coalesce\(max\(version\), 0\) \+ 1/i);
  });

  it('records the authored playbook in the audit trail', async () => {
    const db = dbWithPendingApproval({ taskFamily: 'listing-classify', brief: 'Classify.' });
    await decide(db);
    const audits = db.auditInserts();
    expect(audits.some((a) => (a.params ?? []).includes('playbooks.authored'))).toBe(true);
  });

  /** The capability itself must still never execute without a decision. */
  it('does not author when the approval is rejected', async () => {
    const db = dbWithPendingApproval({ taskFamily: 'listing-classify', brief: 'Classify.' });
    const res = await appWith(db).inject({
      method: 'POST',
      url: '/v1/approvals/decide',
      headers: { authorization: `Bearer ${operatorJwt(testEnv())}` },
      payload: { approvalId: APPROVAL, decision: 'rejected' },
    });

    expect(res.statusCode).toBe(200);
    expect(playbookInsert(db)).toBeUndefined();
  });
});
