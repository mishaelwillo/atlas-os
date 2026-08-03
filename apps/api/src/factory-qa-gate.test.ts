/**
 * The QA gate end to end (docs/specs/p2/website-factory.md).
 *
 * Acceptance: "Required accessibility, responsive, link, structured-data,
 * privacy, security, and performance checks pass before approval." A build
 * that fails one must not reach an approved publish, which means it must be
 * refused twice: when the approval would be created, and again when the
 * approved action is dispatched. The second is what makes the guarantee hold
 * when a descriptor is edited in between.
 */
import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { buildDescriptor, buildDossier } from './factory/dossier.js';
import { renderSite } from './factory/render.js';
import { qaForDescriptor } from './factory/qa.js';
import { FakeDb, buildTestDeps, operatorJwt, testEnv } from './test/fakes.js';

const SPACE = '11111111-2222-3333-4444-555555555555';
const SITE = '99999999-8888-7777-6666-555555555555';
const APPROVAL = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const HTTPS_SRC = 'https://maps.example/acme';

/**
 * A descriptor that renders but fails a required check: the business name is
 * sourced over plain http, so the page would carry an insecure outbound link.
 * The dossier admits it — it is sourced — and QA is what stops it.
 */
function failingDescriptor() {
  return buildDescriptor({
    profileUrl: HTTPS_SRC,
    region: 'global',
    template: 'trades-1',
    stylePack: null,
    dossier: buildDossier([
      { field: 'businessName', value: 'Acme Plumbing', sourceUrl: 'http://maps.example/acme' },
      { field: 'phone', value: '555-0100', sourceUrl: HTTPS_SRC },
      { field: 'hours', value: 'Mon-Fri 9-5', sourceUrl: HTTPS_SRC },
    ]),
  });
}

function passingDescriptor() {
  return buildDescriptor({
    profileUrl: HTTPS_SRC,
    region: 'global',
    template: 'trades-1',
    stylePack: null,
    dossier: buildDossier([
      { field: 'businessName', value: 'Acme Plumbing', sourceUrl: HTTPS_SRC },
      { field: 'phone', value: '555-0100', sourceUrl: HTTPS_SRC },
      { field: 'hours', value: 'Mon-Fri 9-5', sourceUrl: HTTPS_SRC },
    ]),
  });
}

function hashOf(descriptor: ReturnType<typeof passingDescriptor>): string {
  const render = renderSite(descriptor);
  if (!render.rendered) throw new Error('fixture must render');
  return render.hash;
}

function dbWithSite(descriptor: unknown): FakeDb {
  const db = new FakeDb();
  db.when(/from sites where site_id/i, [
    { site_id: SITE, business_name: 'Acme Plumbing', descriptor },
  ]);
  db.when(/insert into approvals/i, [{ approval_id: APPROVAL }]);
  return db;
}

function request(db: FakeDb) {
  return buildApp({ deps: buildTestDeps(db) }).inject({
    method: 'POST',
    url: '/v1/factory/deploy_site',
    headers: {
      authorization: `Bearer ${operatorJwt(testEnv())}`,
      'x-atlas-space': SPACE,
    },
    payload: { siteId: SITE },
  });
}

/** The fixture is only useful if it really renders and really fails QA. */
describe('the failing fixture', () => {
  it('renders, and fails exactly the link check', () => {
    const outcome = qaForDescriptor(failingDescriptor());
    expect(outcome.report).not.toBeNull();
    expect(outcome.failures).toEqual(['link.scheme']);
  });

  it('is otherwise a build that would pass', () => {
    expect(qaForDescriptor(passingDescriptor()).failures).toEqual([]);
  });
});

describe('before the approval exists', () => {
  it('refuses a failing build instead of queuing it', async () => {
    const db = dbWithSite(failingDescriptor());
    const res = await request(db);

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: 'qa_failed', qaFailures: ['link.scheme'] });
  });

  /** The whole point: an operator is never asked to approve the unpublishable. */
  it('creates no approval row for a failing build', async () => {
    const db = dbWithSite(failingDescriptor());
    await request(db);
    expect(db.calls.some((c) => /insert into approvals/i.test(c.sql))).toBe(false);
  });

  it('audits the refusal with the checks that failed', async () => {
    const db = dbWithSite(failingDescriptor());
    await request(db);
    const audit = db
      .auditInserts()
      .find((a) => (a.params ?? []).includes('factory.deploy_site.refused'));
    expect(audit).toBeDefined();
    expect(String(audit?.params?.[4])).toContain('link.scheme');
  });

  it('queues a passing build for approval as before', async () => {
    const db = dbWithSite(passingDescriptor());
    const res = await request(db);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ approvalId: APPROVAL, status: 'review' });
  });
});

describe('when the approved action is dispatched', () => {
  /**
   * The approval carries the hash of the build being dispatched, so the
   * fingerprint check passes and QA is the only thing left to refuse it. That
   * is the case that matters: an approval recorded earlier — or created before
   * this gate existed — must still not be able to publish a failing build.
   */
  function dbForDispatch(descriptor: unknown, approvedHash: string): FakeDb {
    const db = dbWithSite(descriptor);
    db.when(/from approvals where approval_id/i, [
      {
        approval_id: APPROVAL,
        space_id: SPACE,
        run_id: null,
        kind: 'factory.deploy_site',
        payload: { input: { siteId: SITE, buildHash: approvedHash } },
      },
    ]);
    db.when(/from site_deployments where site_id/i, [{ version: 0 }]);
    db.when(/where site_id = \$1 and status = 'live'/i, []);
    db.when(/insert into site_deployments/i, [{ deployment_id: 'dep-new' }]);
    return db;
  }

  async function decide(db: FakeDb) {
    const res = await buildApp({ deps: buildTestDeps(db) }).inject({
      method: 'POST',
      url: '/v1/approvals/decide',
      headers: { authorization: `Bearer ${operatorJwt(testEnv())}` },
      payload: { approvalId: APPROVAL, decision: 'approved' },
    });
    return (res.json() as { dispatched: Record<string, unknown> }).dispatched;
  }

  it('refuses to publish a build that fails a required check', async () => {
    const failing = failingDescriptor();
    const dispatched = await decide(dbForDispatch(failing, hashOf(failing)));

    expect(dispatched.executed).toBe(false);
    expect(dispatched.code).toBe('qa_failed');
    expect(dispatched.qaFailures).toEqual(['link.scheme']);
  });

  it('records no deployment for a build it refused', async () => {
    const failing = failingDescriptor();
    const db = dbForDispatch(failing, hashOf(failing));
    await decide(db);
    expect(db.calls.some((c) => /insert into site_deployments/i.test(c.sql))).toBe(false);
  });

  it('audits the refusal so a blocked publish is not silent', async () => {
    const failing = failingDescriptor();
    const db = dbForDispatch(failing, hashOf(failing));
    await decide(db);
    const audit = db
      .auditInserts()
      .find((a) => (a.params ?? []).includes('factory.deploy_refused'));
    expect(audit).toBeDefined();
    expect(String(audit?.params?.[4])).toContain('link.scheme');
  });

  it('still publishes a build that passes', async () => {
    const passing = passingDescriptor();
    const dispatched = await decide(dbForDispatch(passing, hashOf(passing)));
    expect(dispatched.executed).toBe(true);
  });
});
