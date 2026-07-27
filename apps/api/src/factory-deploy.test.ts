/**
 * factory.deploy_site through approval (docs/specs/p2/website-factory.md).
 * The deploy fires only from approvals.decide, and must promote exactly the
 * approved build or refuse.
 */
import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { buildDescriptor, buildDossier } from './factory/dossier.js';
import { renderSite } from './factory/render.js';
import { FakeDb, buildTestDeps, operatorJwt, testEnv } from './test/fakes.js';

const SPACE = '11111111-2222-3333-4444-555555555555';
const SITE = '99999999-8888-7777-6666-555555555555';
const APPROVAL = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const SRC = 'https://maps.example/acme';

const fact = (field: string, value: string) => ({ field, value, sourceUrl: SRC });

/** A descriptor that satisfies trades-1 and therefore renders. */
function descriptor(phone = '555-0100') {
  return buildDescriptor({
    profileUrl: SRC,
    region: 'global',
    template: 'trades-1',
    stylePack: null,
    dossier: buildDossier([
      fact('businessName', 'Acme Plumbing'),
      fact('phone', phone),
      fact('hours', 'Mon-Fri 9-5'),
    ]),
  });
}

function liveHash(phone?: string): string {
  const r = renderSite(descriptor(phone));
  if (!r.rendered) throw new Error('fixture must render');
  return r.hash;
}

function appWith(db: FakeDb): FastifyInstance {
  return buildApp({ deps: buildTestDeps(db) });
}

function dbFor(options: {
  stored?: unknown;
  approvedHash?: string;
  latestVersion?: number;
  live?: { id: string; version: number; hash: string } | null;
}): FakeDb {
  const db = new FakeDb();
  db.when(/from approvals where approval_id/i, [
    {
      approval_id: APPROVAL,
      space_id: SPACE,
      run_id: null,
      kind: 'factory.deploy_site',
      payload: { input: { siteId: SITE, buildHash: options.approvedHash } },
    },
  ]);
  db.when(/from sites where site_id/i, [
    { site_id: SITE, descriptor: options.stored ?? descriptor() },
  ]);
  db.when(/from site_deployments where site_id/i, [{ version: options.latestVersion ?? 0 }]);
  db.when(
    /where site_id = \$1 and status = 'live'/i,
    options.live
      ? [{ deployment_id: options.live.id, version: options.live.version, build_hash: options.live.hash }]
      : [],
  );
  db.when(/insert into site_deployments/i, [{ deployment_id: 'dep-new' }]);
  return db;
}

async function approve(db: FakeDb) {
  const res = await appWith(db).inject({
    method: 'POST',
    url: '/v1/approvals/decide',
    headers: { authorization: `Bearer ${operatorJwt(testEnv())}` },
    payload: { approvalId: APPROVAL, decision: 'approved' },
  });
  const body = res.json() as { dispatched: Record<string, unknown> };
  return body.dispatched;
}

function deployInsert(db: FakeDb) {
  return db.calls.find((c) => /insert into site_deployments/i.test(c.sql));
}

describe('deploy on approval', () => {
  it('records a verified build as the next version', async () => {
    const db = dbFor({ approvedHash: liveHash(), latestVersion: 2 });
    const dispatched = await approve(db);

    expect(dispatched.executed).toBe(true);
    expect(dispatched.version).toBe(3);
    expect(dispatched.buildHash).toBe(liveHash());
    expect(deployInsert(db)).toBeDefined();
  });

  /** Not serving yet, and the record must not pretend otherwise. */
  it('records the deployment as queued, not live, with no hosting target', async () => {
    const db = dbFor({ approvedHash: liveHash() });
    const dispatched = await approve(db);

    expect(dispatched.status).toBe('queued');
    expect(String(dispatched.note)).toMatch(/not yet serving/i);
    expect((deployInsert(db)?.params ?? []).includes('queued')).toBe(false);
    expect(deployInsert(db)?.sql).toMatch(/'queued'/);
  });

  /**
   * The core acceptance: a descriptor edited between approval and publish must
   * not reach production.
   */
  it('refuses when the descriptor changed after approval', async () => {
    const db = dbFor({ approvedHash: liveHash('555-0100'), stored: descriptor('555-0199') });
    const dispatched = await approve(db);

    expect(dispatched.executed).toBe(false);
    expect(dispatched.code).toBe('build_changed_since_approval');
    expect(deployInsert(db)).toBeUndefined();
  });

  it('refuses when the stored descriptor no longer renders', async () => {
    const thin = buildDescriptor({
      profileUrl: SRC,
      region: 'global',
      template: 'trades-1',
      stylePack: null,
      dossier: buildDossier([fact('businessName', 'Acme Plumbing')]),
    });
    const db = dbFor({ approvedHash: 'a'.repeat(64), stored: thin });
    const dispatched = await approve(db);

    expect(dispatched.executed).toBe(false);
    expect(dispatched.code).toBe('template_unsatisfied');
    expect(deployInsert(db)).toBeUndefined();
  });

  it('refuses to republish a build that is already live', async () => {
    const hash = liveHash();
    const db = dbFor({
      approvedHash: hash,
      latestVersion: 1,
      live: { id: 'dep-1', version: 1, hash },
    });
    const dispatched = await approve(db);

    expect(dispatched.code).toBe('already_live');
    expect(deployInsert(db)).toBeUndefined();
  });

  it('supersedes a different live build', async () => {
    const db = dbFor({
      approvedHash: liveHash(),
      latestVersion: 1,
      live: { id: 'dep-1', version: 1, hash: 'b'.repeat(64) },
    });
    const dispatched = await approve(db);

    expect(dispatched.executed).toBe(true);
    expect(dispatched.supersedes).toBe('dep-1');
  });

  it('audits a refusal so a blocked publish is not silent', async () => {
    const db = dbFor({ approvedHash: liveHash('555-0100'), stored: descriptor('555-0199') });
    await approve(db);
    expect(
      db.auditInserts().some((a) => (a.params ?? []).includes('factory.deploy_refused')),
    ).toBe(true);
  });

  it('audits a queued deployment with its build hash', async () => {
    const db = dbFor({ approvedHash: liveHash() });
    await approve(db);
    expect(
      db.auditInserts().some((a) => (a.params ?? []).includes('factory.deploy_queued')),
    ).toBe(true);
  });

  it('records the renderer commit so a byte change stays attributable', async () => {
    const db = dbFor({ approvedHash: liveHash() });
    await approve(db);
    expect((deployInsert(db)?.params ?? []).includes('abc1234')).toBe(true);
  });

  it('reports a missing site rather than recording a deployment', async () => {
    // Built without a site responder: FakeDb returns the first match, so a
    // later registration could not override one added by the helper.
    const db = new FakeDb();
    db.when(/from approvals where approval_id/i, [
      {
        approval_id: APPROVAL,
        space_id: SPACE,
        run_id: null,
        kind: 'factory.deploy_site',
        payload: { input: { siteId: SITE } },
      },
    ]);
    db.when(/insert into site_deployments/i, [{ deployment_id: 'dep-new' }]);
    const dispatched = await approve(db);

    expect(dispatched.executed).toBe(false);
    expect(String(dispatched.note)).toMatch(/not found/i);
    expect(deployInsert(db)).toBeUndefined();
  });
});
