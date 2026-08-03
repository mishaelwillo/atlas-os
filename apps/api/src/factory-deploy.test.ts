/**
 * factory.deploy_site through approval (docs/specs/p2/website-factory.md).
 * The deploy fires only from approvals.decide, and must promote exactly the
 * approved build or refuse.
 */
import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { buildDescriptor, buildDossier } from './factory/dossier.js';
import { renderSite } from './factory/render.js';
import { FakeDb, buildTestDeps, operatorJwt, testEnv } from './test/fakes.js';
import type { PipelineDeps } from './pipeline.js';

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
    { site_id: SITE, business_name: 'Acme Plumbing', descriptor: options.stored ?? descriptor() },
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

/** A hosting adapter that accepts, recording what it was handed. */
function publishingHost() {
  const published: Array<{ slug: string; html: string; buildHash: string; version: number }> = [];
  return {
    name: 'test-host',
    published,
    publish: async (target: { slug: string; html: string; buildHash: string; version: number }) => {
      published.push(target);
      return { url: `https://sites.example.com/${target.slug}`, providerRef: 'cf-dep-1' };
    },
  };
}

async function approve(
  db: FakeDb,
  hosting?: { name: string; publish: (t: never) => Promise<{ url: string; providerRef: string | null }> },
  readPublic?: PipelineDeps['readPublic'],
) {
  const deps = hosting
    ? { ...buildTestDeps(db), hosting: hosting as unknown as PipelineDeps['hosting'] }
    : buildTestDeps(db);
  if (readPublic) deps.readPublic = readPublic;
  const res = await buildApp({ deps }).inject({
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

  /**
   * Test deps use the refusing adapter, so this is the unconfigured path: the
   * attempt is recorded as queued with the provider's reason, and no address
   * is claimed.
   */
  it('records a queued deployment carrying the reason when publishing fails', async () => {
    const db = dbFor({ approvedHash: liveHash() });
    const dispatched = await approve(db);

    expect(dispatched.status).toBe('queued');
    expect(dispatched.url).toBeNull();
    expect(String(dispatched.note)).toMatch(/not serving/i);
    expect((deployInsert(db)?.params ?? []).includes('queued')).toBe(true);
    // The address column stays null rather than holding a guess.
    expect((deployInsert(db)?.params ?? []).includes(null)).toBe(true);
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

  /**
   * The read-back the 2026-08-03 benchmark proved was missing: `build_hash` is
   * what Atlas intended to publish, and until this existed nothing checked what
   * a reader actually receives.
   */
  describe('reading the published address back', () => {
    function servedHtml(): string {
      const r = renderSite(descriptor());
      if (!r.rendered) throw new Error('fixture must render');
      return r.html;
    }

    it('records a matching fingerprint when the address serves the approved build', async () => {
      const db = dbFor({ approvedHash: liveHash() });
      const dispatched = await approve(db, publishingHost(), async () => ({
        status: 200,
        body: servedHtml(),
      }));

      expect(dispatched.fingerprint).toBe('match');
      expect(dispatched.publicFingerprint).toBe(liveHash());
      const params = deployInsert(db)?.params ?? [];
      expect(params).toContain(liveHash());
      expect(params).toContain(true);
    });

    /** The real finding: the edge injected a script, so the reader got other bytes. */
    it('records a mismatch when something changed the bytes in transit', async () => {
      const db = dbFor({ approvedHash: liveHash() });
      const dispatched = await approve(db, publishingHost(), async () => ({
        status: 200,
        body: `${servedHtml()}<script>/* injected */</script>`,
      }));

      expect(dispatched.fingerprint).toBe('mismatch');
      expect(dispatched.publicFingerprint).not.toBe(liveHash());
      expect((deployInsert(db)?.params ?? [])).toContain(false);
      // Still live: the site is serving, and saying otherwise would be its own lie.
      expect(dispatched.status).toBe('live');
      expect(String(dispatched.note)).toMatch(/not the approved/i);
    });

    /** Unreadable is not a match; the row must not claim a verified fingerprint. */
    it('records unreadable rather than assuming the publish was faithful', async () => {
      const db = dbFor({ approvedHash: liveHash() });
      const dispatched = await approve(db, publishingHost(), async () => {
        throw new Error('ECONNRESET');
      });

      expect(dispatched.fingerprint).toBe('unreadable');
      expect(dispatched.publicFingerprint).toBeUndefined();
      const params = deployInsert(db)?.params ?? [];
      expect(params).toContain(false);
      expect(params).not.toContain(liveHash().replace('a', 'b'));
    });

    /** A read-back failure must never cost the deployment record. */
    it('still records the deployment when the read-back fails', async () => {
      const db = dbFor({ approvedHash: liveHash() });
      const dispatched = await approve(db, publishingHost(), async () => {
        throw new Error('ECONNRESET');
      });

      expect(dispatched.executed).toBe(true);
      expect(deployInsert(db)).toBeDefined();
    });

    /** Nothing was published, so there is nothing to read back. */
    it('records no fingerprint for a queued deployment', async () => {
      const db = dbFor({ approvedHash: liveHash() });
      const dispatched = await approve(db);

      expect(dispatched.status).toBe('queued');
      expect(dispatched.fingerprint).toBeNull();
    });
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

  it('records a live deployment with its address when the provider accepts it', async () => {
    const db = dbFor({ approvedHash: liveHash() });
    const dispatched = await approve(db, publishingHost());

    expect(dispatched.status).toBe('live');
    expect(dispatched.url).toBe('https://sites.example.com/acme-plumbing-99999999');
    expect(dispatched.providerRef).toBe('cf-dep-1');
    expect((deployInsert(db)?.params ?? []).includes('live')).toBe(true);
  });

  it('hands the provider the exact verified build', async () => {
    const db = dbFor({ approvedHash: liveHash() });
    const host = publishingHost();
    await approve(db, host);

    expect(host.published).toHaveLength(1);
    expect(host.published[0].buildHash).toBe(liveHash());
    const expected = renderSite(descriptor());
    if (!expected.rendered) throw new Error('fixture must render');
    expect(host.published[0].html).toBe(expected.html);
  });

  /** A partial unique index allows one live deployment per site. */
  it('steps the previous deployment down when a new one goes live', async () => {
    const db = dbFor({
      approvedHash: liveHash(),
      latestVersion: 1,
      live: { id: 'dep-1', version: 1, hash: 'b'.repeat(64) },
    });
    await approve(db, publishingHost());

    const supersede = db.calls.find((c) => /set status = 'superseded'/i.test(c.sql));
    expect(supersede).toBeDefined();
    expect((supersede?.params ?? []).includes('dep-1')).toBe(true);
  });

  it('does not step anything down when the publish failed', async () => {
    const db = dbFor({
      approvedHash: liveHash(),
      latestVersion: 1,
      live: { id: 'dep-1', version: 1, hash: 'b'.repeat(64) },
    });
    await approve(db);

    expect(db.calls.some((c) => /set status = 'superseded'/i.test(c.sql))).toBe(false);
  });

  it('audits the outcome that actually happened', async () => {
    const db = dbFor({ approvedHash: liveHash() });
    await approve(db, publishingHost());
    expect(
      db.auditInserts().some((a) => (a.params ?? []).includes('factory.deploy_live')),
    ).toBe(true);
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
