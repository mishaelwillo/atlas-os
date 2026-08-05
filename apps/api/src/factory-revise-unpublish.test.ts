/**
 * factory.revise_site and factory.unpublish
 * (docs/specs/p2/website-factory.md).
 *
 * These close two gaps the production verification run exposed. A site had
 * exactly one descriptor for ever, so it could never reach version 2 and
 * `factory.rollback` had nothing to restore. And nothing could take a site
 * down — rollback restores an earlier version, it does not withdraw — so both
 * fixture takedowns were direct database writes recorded as `rolled_back`,
 * which reads as a restore that never happened.
 */
import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { buildDescriptor, buildDossier } from './factory/dossier.js';
import { renderSite } from './factory/render.js';
import { sha256 } from './factory/fingerprint.js';
import { FakeDb, buildTestDeps, operatorJwt, testEnv } from './test/fakes.js';
import type { PipelineDeps } from './pipeline.js';

const SPACE = '11111111-2222-3333-4444-555555555555';
const SITE = '99999999-8888-7777-6666-555555555555';
const APPROVAL = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
/** The build being taken down, so the read-back can tell it from anything else. */
const WITHDRAWN_HTML = '<!doctype html><html lang="en"><body>Acme</body></html>';
const WITHDRAWN_HASH = sha256(WITHDRAWN_HTML);
const SRC = 'https://maps.example/acme';

const fact = (field: string, value: string) => ({ field, value, sourceUrl: SRC });

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

function headers() {
  return { authorization: `Bearer ${operatorJwt(testEnv())}`, 'x-atlas-space': SPACE };
}

function app(db: FakeDb, over: Partial<PipelineDeps> = {}) {
  return buildApp({ deps: { ...buildTestDeps(db), ...over } });
}

describe('factory.revise_site', () => {
  function dbWithSite(): FakeDb {
    const db = new FakeDb();
    db.when(/select site_id, descriptor, template, style_pack, source_profile from sites/i, [
      { site_id: SITE, descriptor: descriptor(), template: 'trades-1', style_pack: null, source_profile: {} },
    ]);
    return db;
  }

  async function revise(db: FakeDb, facts: unknown[]) {
    const res = await app(db).inject({
      method: 'POST',
      url: '/v1/factory/revise_site',
      headers: headers(),
      payload: { siteId: SITE, facts },
    });
    return { statusCode: res.statusCode, body: res.json() as Record<string, unknown> };
  }

  /** The whole point: a second descriptor means a second version is possible. */
  it('produces a different build hash from the same site', async () => {
    const db = dbWithSite();
    const before = renderSite(descriptor());
    const { body } = await revise(db, [
      fact('businessName', 'Acme Plumbing'),
      fact('phone', '555-0199'),
      fact('hours', 'Mon-Fri 9-5'),
    ]);

    expect(body.revised).toBe(true);
    if (!before.rendered) throw new Error('fixture must render');
    expect(body.buildHash).not.toBe(before.hash);
    expect(db.calls.some((c) => /update sites set descriptor/i.test(c.sql))).toBe(true);
  });

  /** New facts get the same scrutiny as the first ones. */
  it('blocks an unsourced fact in the revision', async () => {
    const db = dbWithSite();
    const { body } = await revise(db, [
      fact('businessName', 'Acme Plumbing'),
      { field: 'phone', value: '555-0199' },
      fact('hours', 'Mon-Fri 9-5'),
    ]);

    const blocked = body.blocked as Array<{ field: string; reason: string }>;
    expect(blocked.map((b) => b.field)).toContain('phone');
    expect(blocked.find((b) => b.field === 'phone')?.reason).toBe('unsourced');
  });

  it('runs QA on the revised build', async () => {
    const db = dbWithSite();
    const { body } = await revise(db, [
      fact('businessName', 'Acme Plumbing'),
      fact('phone', '555-0199'),
      fact('hours', 'Mon-Fri 9-5'),
    ]);
    expect((body.qa as { passed: boolean }).passed).toBe(true);
    expect(body.status).toBe('preview_built');
  });

  /** Without a sourced name there is nothing that can honestly be displayed. */
  it('refuses a revision with no sourced business name', async () => {
    const db = dbWithSite();
    const { body } = await revise(db, [fact('phone', '555-0199')]);

    expect(body.revised).toBe(false);
    expect(body.status).toBe('facts_pending_review');
    expect(db.calls.some((c) => /update sites set descriptor/i.test(c.sql))).toBe(false);
  });

  /** An empty revision would blank the page rather than change it. */
  it('refuses an empty fact set', async () => {
    const { statusCode } = await revise(dbWithSite(), []);
    expect(statusCode).toBe(400);
  });

  it('reports a site that does not exist', async () => {
    const { statusCode } = await revise(new FakeDb(), [fact('businessName', 'X')]);
    expect(statusCode).toBe(404);
  });

  it('audits the revision', async () => {
    const db = dbWithSite();
    await revise(db, [
      fact('businessName', 'Acme Plumbing'),
      fact('phone', '555-0199'),
      fact('hours', 'Mon-Fri 9-5'),
    ]);
    expect(db.auditInserts().some((a) => (a.params ?? []).includes('factory.site_revised'))).toBe(true);
  });
});

describe('factory.unpublish', () => {
  function withdrawingHost() {
    const calls: string[] = [];
    return {
      name: 'test-host',
      calls,
      publish: async (t: { slug: string; alsoServe: unknown[] }) => {
        calls.push(`publish:${t.slug}+${t.alsoServe.length}`);
        return { url: `https://sites.example.com/${t.slug}`, providerRef: 'cf-1' };
      },
      withdrawAll: async () => {
        calls.push('withdrawAll');
      },
    };
  }

  function dbFor(remaining: Array<Record<string, unknown>>, liveRow = true): FakeDb {
    const db = new FakeDb();
    db.when(/from approvals where approval_id/i, [
      {
        approval_id: APPROVAL,
        space_id: SPACE,
        run_id: null,
        kind: 'factory.unpublish',
        payload: { input: { siteId: SITE } },
      },
    ]);
    db.when(
      /from site_deployments\s+where site_id = \$1 and status = 'live'/i,
      liveRow
        ? [
            {
              deployment_id: 'dep-1',
              version: 1,
              domain: 'https://sites.example.com/acme',
              build_hash: WITHDRAWN_HASH,
            },
          ]
        : [],
    );
    db.when(/from site_deployments d\s+join sites s/i, remaining);
    return db;
  }

  async function approve(
    db: FakeDb,
    host: ReturnType<typeof withdrawingHost>,
    readPublic?: PipelineDeps['readPublic'],
  ) {
    const res = await app(db, {
      hosting: host as unknown as PipelineDeps['hosting'],
      ...(readPublic ? { readPublic } : {}),
    }).inject({
      method: 'POST',
      url: '/v1/approvals/decide',
      headers: { authorization: `Bearer ${operatorJwt(testEnv())}` },
      payload: { approvalId: APPROVAL, decision: 'approved' },
    });
    return (res.json() as { dispatched: Record<string, unknown> }).dispatched;
  }

  /** Nothing left to serve needs an explicit empty snapshot. */
  it('withdraws everything when it was the last live site', async () => {
    const db = dbFor([]);
    const host = withdrawingHost();
    const dispatched = await approve(db, host);

    expect(dispatched).toMatchObject({ executed: true, stillServing: 0 });
    expect(host.calls).toEqual(['withdrawAll']);
    const update = db.calls.find((c) => /set status = 'unpublished'/i.test(c.sql));
    expect((update?.params ?? [])).toContain('dep-1');
  });

  /** The survivors are republished from what they published, never re-rendered. */
  it('republishes the remaining live sites without this one', async () => {
    const other = renderSite(descriptor('555-0177'));
    if (!other.rendered) throw new Error('fixture must render');
    const db = dbFor([
      { site_id: 'site-b', build_html: other.html, business_name: 'Bravo Plumbing' },
      { site_id: 'site-c', build_html: other.html, business_name: 'Charlie Roofing' },
    ]);
    const host = withdrawingHost();
    const dispatched = await approve(db, host);

    expect(dispatched).toMatchObject({ executed: true, stillServing: 2 });
    // One publish carrying the first survivor plus the rest.
    expect(host.calls).toEqual(['publish:bravo-plumbing-siteb+1']);
  });

  /** Withdrawing one site must not take another down as collateral. */
  it('refuses when a surviving site has no retained bytes', async () => {
    const db = dbFor([{ site_id: 'site-b', build_html: null, business_name: 'Bravo Plumbing' }]);
    const host = withdrawingHost();
    const dispatched = await approve(db, host);

    expect(dispatched).toMatchObject({ executed: false, code: 'sibling_no_stored_build' });
    expect(host.calls).toEqual([]);
    expect(db.calls.some((c) => /set status = 'unpublished'/i.test(c.sql))).toBe(false);
  });

  it('refuses when the site has nothing live', async () => {
    const dispatched = await approve(dbFor([], false), withdrawingHost());
    expect(dispatched).toMatchObject({ executed: false, code: 'not_live' });
  });

  /** A provider refusal must not record a withdrawal that did not happen. */
  it('leaves the deployment live when the provider refuses', async () => {
    const db = dbFor([]);
    const host = {
      name: 'test-host',
      calls: [] as string[],
      publish: async () => ({ url: 'x', providerRef: null }),
      withdrawAll: async () => {
        throw new Error('provider down');
      },
    };
    const dispatched = await approve(db, host as unknown as ReturnType<typeof withdrawingHost>);

    expect(dispatched).toMatchObject({ executed: false, code: 'provider_refused' });
    expect(db.calls.some((c) => /set status = 'unpublished'/i.test(c.sql))).toBe(false);
  });

  it('audits the withdrawal', async () => {
    const db = dbFor([]);
    await approve(db, withdrawingHost());
    expect(db.auditInserts().some((a) => (a.params ?? []).includes('factory.unpublished'))).toBe(true);
  });

  /*
   * The provider accepting a snapshot is not the public having stopped
   * receiving the site. A committed withdrawal kept serving for twenty to
   * forty seconds in production and nothing checked; the hourly sweep cannot,
   * because it only walks deployments that are still `live`.
   */
  describe('confirming the address stopped serving', () => {
    const gone: PipelineDeps['readPublic'] = async () => ({ status: 404, body: '' });
    const stillServing: PipelineDeps['readPublic'] = async () => ({
      status: 200,
      body: WITHDRAWN_HTML,
    });

    it('reports the withdrawal confirmed when the address stops serving', async () => {
      const db = dbFor([]);
      const dispatched = await approve(db, withdrawingHost(), gone);

      expect(dispatched).toMatchObject({ executed: true, withdrawal: 'withdrawn' });
      expect(String(dispatched.note)).toMatch(/confirmed gone/);
    });

    /** The failure this closes: reported withdrawn while still public. */
    it('says so when the address is still serving the withdrawn build', async () => {
      const db = dbFor([]);
      const dispatched = await approve(db, withdrawingHost(), stillServing);

      expect(dispatched).toMatchObject({ executed: true, withdrawal: 'still_serving' });
      expect(String(dispatched.note)).toMatch(/still serves the build that was taken down/);
      expect(String(dispatched.note)).not.toMatch(/confirmed gone/);
    });

    /** Atlas has told the provider to stop; the record must say that either way. */
    it('still records the withdrawal when the address has not caught up', async () => {
      const db = dbFor([]);
      await approve(db, withdrawingHost(), stillServing);

      expect(db.calls.some((c) => /set status = 'unpublished'/i.test(c.sql))).toBe(true);
    });

    it('audits which verdict the read-back reached', async () => {
      const db = dbFor([]);
      await approve(db, withdrawingHost(), stillServing);

      const audit = db
        .auditInserts()
        .find((a) => (a.params ?? []).includes('factory.unpublished'));
      expect(JSON.stringify(audit?.params ?? [])).toContain('still_serving');
    });

    /** An unreadable address is not a withdrawn one. */
    it('does not claim gone when the address cannot be read', async () => {
      const db = dbFor([]);
      const dispatched = await approve(db, withdrawingHost(), async () => {
        throw new Error('ECONNRESET');
      });

      expect(dispatched).toMatchObject({ withdrawal: 'unreadable' });
      // "not confirmed gone" — the absence of a claim, not a claim of absence.
      expect(String(dispatched.note)).toMatch(/not confirmed gone/);
      expect(String(dispatched.note)).not.toMatch(/and confirmed gone/);
    });
  });

  /** Withdrawal is privileged: it never runs on request. */
  it('holds the request behind an approval', async () => {
    const db = new FakeDb();
    db.when(/insert into approvals/i, [{ approval_id: APPROVAL }]);
    const res = await app(db).inject({
      method: 'POST',
      url: '/v1/factory/unpublish',
      headers: headers(),
      payload: { siteId: SITE },
    });
    expect(res.json()).toMatchObject({ approvalId: APPROVAL, status: 'review' });
  });
});
