/**
 * factory.rollback through approval (docs/specs/p2/website-factory.md).
 *
 * Acceptance: "rollback proves previous fingerprint healthy". Only a deployment
 * that was actually observed serving qualifies, and only one whose exact bytes
 * were retained — rendering something in its place would republish a build
 * nobody approved under the name of one that was.
 *
 * Until this existed there was no rollback capability at all: `planRollback`
 * was a tested pure function nothing routed to, so taking a site down meant
 * writing to the database by hand.
 */
import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { FakeDb, buildTestDeps, operatorJwt, testEnv } from './test/fakes.js';
import { sha256 } from './factory/fingerprint.js';
import type { PipelineDeps } from './pipeline.js';

const SPACE = '11111111-2222-3333-4444-555555555555';
const SITE = '99999999-8888-7777-6666-555555555555';
const APPROVAL = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

const OLD_HTML = '<html>version one</html>';
const NEW_HTML = '<html>version two</html>';
const OLD_HASH = sha256(OLD_HTML);
const NEW_HASH = sha256(NEW_HTML);

function publishingHost() {
  const published: Array<{ slug: string; html: string; buildHash: string; alsoServe: unknown[] }> = [];
  return {
    name: 'test-host',
    published,
    publish: async (target: { slug: string; html: string; buildHash: string; alsoServe: unknown[] }) => {
      published.push(target);
      return { url: `https://sites.example.com/${target.slug}`, providerRef: 'cf-1' };
    },
  };
}

function dbFor(history: Array<Record<string, unknown>>): FakeDb {
  const db = new FakeDb();
  db.when(/from approvals where approval_id/i, [
    {
      approval_id: APPROVAL,
      space_id: SPACE,
      run_id: null,
      kind: 'factory.rollback',
      payload: { input: { siteId: SITE } },
    },
  ]);
  db.when(/select site_id, business_name from sites/i, [
    { site_id: SITE, business_name: 'Acme Plumbing' },
  ]);
  db.when(/from site_deployments\s+where site_id = \$1 and environment/i, history);
  db.when(/from site_deployments d\s+join sites s/i, []);
  db.when(/insert into site_deployments/i, [{ deployment_id: 'dep-new' }]);
  return db;
}

const PREVIOUS = {
  deployment_id: 'dep-1',
  version: 1,
  build_hash: OLD_HASH,
  status: 'superseded',
  went_live_at: '2026-08-01T00:00:00.000Z',
  build_html: OLD_HTML,
};
const CURRENT = {
  deployment_id: 'dep-2',
  version: 2,
  build_hash: NEW_HASH,
  status: 'live',
  went_live_at: '2026-08-02T00:00:00.000Z',
  build_html: NEW_HTML,
};

async function approve(
  db: FakeDb,
  hosting?: ReturnType<typeof publishingHost>,
  readPublic?: PipelineDeps['readPublic'],
) {
  const deps = { ...buildTestDeps(db) };
  if (hosting) deps.hosting = hosting as unknown as PipelineDeps['hosting'];
  if (readPublic) deps.readPublic = readPublic;
  const res = await buildApp({ deps }).inject({
    method: 'POST',
    url: '/v1/approvals/decide',
    headers: { authorization: `Bearer ${operatorJwt(testEnv())}` },
    payload: { approvalId: APPROVAL, decision: 'approved' },
  });
  return (res.json() as { dispatched: Record<string, unknown> }).dispatched;
}

function insert(db: FakeDb) {
  return db.calls.find((c) => /insert into site_deployments/i.test(c.sql));
}

describe('rolling a site back', () => {
  it('republishes the exact bytes the previous deployment served', async () => {
    const db = dbFor([CURRENT, PREVIOUS]);
    const host = publishingHost();
    const dispatched = await approve(db, host, async () => ({ status: 200, body: OLD_HTML }));

    expect(dispatched).toMatchObject({
      executed: true,
      restored: 'dep-1',
      restoredVersion: 1,
      buildHash: OLD_HASH,
      status: 'live',
    });
    expect(host.published[0].html).toBe(OLD_HTML);
  });

  it('records the restore as a new version, not a revived row', async () => {
    const db = dbFor([CURRENT, PREVIOUS]);
    const dispatched = await approve(db, publishingHost(), async () => ({ status: 200, body: OLD_HTML }));

    expect(dispatched.version).toBe(3);
    const params = insert(db)?.params ?? [];
    expect(params).toContain(3);
    // Points at what it restored, so the sequence stays readable.
    expect(params).toContain('dep-1');
  });

  it('steps the superseded deployment down', async () => {
    const db = dbFor([CURRENT, PREVIOUS]);
    await approve(db, publishingHost(), async () => ({ status: 200, body: OLD_HTML }));

    const down = db.calls.find((c) => /set status = 'rolled_back'/i.test(c.sql));
    expect((down?.params ?? [])).toContain('dep-2');
  });

  /**
   * Same ordering requirement as a publish, and it had the same defect: the
   * step-down sat below the insert, so `site_deployments_one_live` would
   * reject the restored row before anything stepped down. `factory.rollback`
   * had never run against a real database, so nothing had ever hit it.
   */
  it('steps the current deployment down BEFORE inserting the restore', async () => {
    const db = dbFor([CURRENT, PREVIOUS]);
    await approve(db, publishingHost(), async () => ({ status: 200, body: OLD_HTML }));

    const downAt = db.calls.findIndex((c) => /set status = 'rolled_back'/i.test(c.sql));
    const insertAt = db.calls.findIndex((c) => /insert into site_deployments/i.test(c.sql));
    expect(downAt).toBeGreaterThanOrEqual(0);
    expect(insertAt).toBeGreaterThanOrEqual(0);
    expect(downAt).toBeLessThan(insertAt);
  });

  it('verifies the restored address serves what it restored', async () => {
    const db = dbFor([CURRENT, PREVIOUS]);
    const dispatched = await approve(db, publishingHost(), async () => ({ status: 200, body: OLD_HTML }));

    expect(dispatched.fingerprint).toBe('match');
    expect((insert(db)?.params ?? [])).toContain(OLD_HASH);
  });

  it('reports a mismatch without pretending the rollback failed', async () => {
    const db = dbFor([CURRENT, PREVIOUS]);
    const dispatched = await approve(db, publishingHost(), async () => ({
      status: 200,
      body: `${OLD_HTML}<script></script>`,
    }));

    expect(dispatched).toMatchObject({ executed: true, status: 'live', fingerprint: 'mismatch' });
  });

  /** Retains the bytes so the restore is itself rollback-able. */
  it('keeps the restored bytes with the new row', async () => {
    const db = dbFor([CURRENT, PREVIOUS]);
    await approve(db, publishingHost(), async () => ({ status: 200, body: OLD_HTML }));
    expect((insert(db)?.params ?? [])).toContain(OLD_HTML);
  });
});

describe('when a rollback is refused', () => {
  it('refuses when nothing is live', async () => {
    const db = dbFor([{ ...PREVIOUS, status: 'superseded' }]);
    const dispatched = await approve(db, publishingHost());

    expect(dispatched).toMatchObject({ executed: false, code: 'no_live_deployment' });
    expect(insert(db)).toBeUndefined();
  });

  /** Proven healthy means observed serving, not merely recorded. */
  it('refuses a predecessor that never actually served', async () => {
    const db = dbFor([CURRENT, { ...PREVIOUS, went_live_at: null }]);
    const dispatched = await approve(db, publishingHost());

    expect(dispatched).toMatchObject({ executed: false, code: 'no_healthy_predecessor' });
    expect(insert(db)).toBeUndefined();
  });

  /** Rendering something else would republish a build nobody approved. */
  it('refuses when the predecessor predates build retention', async () => {
    const db = dbFor([CURRENT, { ...PREVIOUS, build_html: null }]);
    const dispatched = await approve(db, publishingHost());

    expect(dispatched).toMatchObject({ executed: false, code: 'no_stored_build' });
    expect(insert(db)).toBeUndefined();
  });

  it('audits every refusal', async () => {
    const db = dbFor([CURRENT, { ...PREVIOUS, build_html: null }]);
    await approve(db, publishingHost());
    expect(
      db.auditInserts().some((a) => (a.params ?? []).includes('factory.rollback_refused')),
    ).toBe(true);
  });

  it('reports a missing site rather than rolling anything back', async () => {
    const db = new FakeDb();
    db.when(/from approvals where approval_id/i, [
      {
        approval_id: APPROVAL,
        space_id: SPACE,
        run_id: null,
        kind: 'factory.rollback',
        payload: { input: { siteId: SITE } },
      },
    ]);
    const dispatched = await approve(db);
    expect(dispatched).toMatchObject({ executed: false });
    expect(String(dispatched.note)).toMatch(/not found/i);
  });
});

describe('the approval gate', () => {
  /** Rollback is privileged and audited; it never runs on request. */
  it('holds the request rather than rolling back immediately', async () => {
    const db = new FakeDb();
    db.when(/insert into approvals/i, [{ approval_id: APPROVAL }]);
    const res = await buildApp({ deps: buildTestDeps(db) }).inject({
      method: 'POST',
      url: '/v1/factory/rollback',
      headers: {
        authorization: `Bearer ${operatorJwt(testEnv())}`,
        'x-atlas-space': SPACE,
      },
      payload: { siteId: SITE },
    });

    expect(res.json()).toMatchObject({ approvalId: APPROVAL, status: 'review' });
    expect(db.calls.some((c) => /insert into site_deployments/i.test(c.sql))).toBe(false);
  });
});
