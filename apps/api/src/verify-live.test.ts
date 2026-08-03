/**
 * factory.verify_live (docs/specs/p2/website-factory.md).
 *
 * The gap this closes cost something real: a published site sat answering 404
 * for an hour while its deployment row read `live`, because a later publish had
 * replaced the whole project. The post-publish read-back could not have caught
 * it — it proves the deployment being made, never the ones made before.
 */
import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { FakeDb, buildTestDeps, operatorJwt, testEnv } from './test/fakes.js';
import { classifyLive, summariseSweep, type SweepEntry } from './factory/sweep.js';
import { sha256 } from './factory/fingerprint.js';
import type { PipelineDeps } from './pipeline.js';

const SPACE = '11111111-2222-3333-4444-555555555555';
const HTML_A = '<html>Acme</html>';
const HTML_B = '<html>Bravo</html>';
const HASH_A = sha256(HTML_A);
const HASH_B = sha256(HTML_B);

function headers() {
  return { authorization: `Bearer ${operatorJwt(testEnv())}`, 'x-atlas-space': SPACE };
}

function dbWithLive(rows: Array<Record<string, unknown>>): FakeDb {
  const db = new FakeDb();
  db.when(/from site_deployments\s+where status = 'live'/i, rows);
  return db;
}

async function sweep(db: FakeDb, readPublic: PipelineDeps['readPublic']) {
  const deps = { ...buildTestDeps(db), readPublic };
  const res = await buildApp({ deps }).inject({
    method: 'POST',
    url: '/v1/factory/verify_live',
    headers: headers(),
    payload: {},
  });
  return { statusCode: res.statusCode, body: res.json() as Record<string, unknown> };
}

const LIVE_A = { deployment_id: 'dep-a', site_id: 'site-a', domain: 'https://sites.example/a', build_hash: HASH_A };
const LIVE_B = { deployment_id: 'dep-b', site_id: 'site-b', domain: 'https://sites.example/b', build_hash: HASH_B };

describe('sweeping live sites', () => {
  it('reports healthy when every address serves its approved build', async () => {
    const db = dbWithLive([LIVE_A, LIVE_B]);
    const { body } = await sweep(db, async (url) => ({
      status: 200,
      body: url.endsWith('/a') ? HTML_A : HTML_B,
    }));

    expect(body).toMatchObject({ checked: 2, matching: 2, healthy: true, status: 'ok' });
    expect(body.mismatched).toEqual([]);
  });

  /** The exact failure that went unnoticed: live row, address serving nothing. */
  it('catches a live site that has gone dark', async () => {
    const db = dbWithLive([LIVE_A]);
    const { body } = await sweep(db, async () => ({ status: 404, body: '' }));

    expect(body).toMatchObject({ checked: 1, matching: 0, healthy: false, status: 'drifted' });
    expect((body.unreadable as SweepEntry[])[0]).toMatchObject({
      deploymentId: 'dep-a',
      verdict: 'unreadable',
    });
  });

  it('catches a live site serving bytes nobody approved', async () => {
    const db = dbWithLive([LIVE_A]);
    const { body } = await sweep(db, async () => ({ status: 200, body: `${HTML_A}<script></script>` }));

    expect(body).toMatchObject({ healthy: false, status: 'drifted' });
    const [entry] = body.mismatched as SweepEntry[];
    expect(entry).toMatchObject({ deploymentId: 'dep-a', verdict: 'mismatch' });
    expect(entry.observed).not.toBe(HASH_A);
  });

  it('finds the one bad site among healthy ones', async () => {
    const db = dbWithLive([LIVE_A, LIVE_B]);
    const { body } = await sweep(db, async (url) => ({
      status: 200,
      body: url.endsWith('/a') ? HTML_A : 'something else',
    }));

    expect(body).toMatchObject({ checked: 2, matching: 1, healthy: false });
    expect((body.mismatched as SweepEntry[]).map((m) => m.deploymentId)).toEqual(['dep-b']);
  });

  /** A live row with nowhere to serve from is a defect, not something to skip. */
  it('reports a live deployment that records no address', async () => {
    const db = dbWithLive([{ ...LIVE_A, domain: null }]);
    const { body } = await sweep(db, async () => {
      throw new Error('should not be called');
    });

    expect(body).toMatchObject({ checked: 1, healthy: false });
    expect((body.mismatched as SweepEntry[])[0].verdict).toBe('no_address');
  });

  it('treats an unreachable address as unhealthy, not as probably fine', async () => {
    const db = dbWithLive([LIVE_A]);
    const { body } = await sweep(db, async () => {
      throw new Error('ECONNRESET');
    });

    expect(body.healthy).toBe(false);
    expect((body.unreadable as SweepEntry[])[0].message).toContain('ECONNRESET');
  });

  it('is trivially healthy when nothing is live', async () => {
    const { body } = await sweep(new FakeDb(), async () => ({ status: 200, body: '' }));
    expect(body).toMatchObject({ checked: 0, matching: 0, healthy: true });
  });
});

describe('what the sweep records', () => {
  it('stamps every checked deployment, including the healthy ones', async () => {
    const db = dbWithLive([LIVE_A]);
    await sweep(db, async () => ({ status: 200, body: HTML_A }));

    const update = db.calls.find((c) => /update site_deployments/i.test(c.sql));
    expect(update?.sql).toMatch(/fingerprint_checked_at = now\(\)/);
    expect((update?.params ?? [])).toContain(HASH_A);
    expect((update?.params ?? [])).toContain(true);
  });

  /** Nothing is un-published: the site that has gone wrong is still public. */
  it('changes no deployment state', async () => {
    const db = dbWithLive([LIVE_A]);
    await sweep(db, async () => ({ status: 404, body: '' }));

    const updates = db.calls.filter((c) => /update site_deployments/i.test(c.sql));
    expect(updates).toHaveLength(1);
    expect(updates[0].sql).not.toMatch(/\bstatus\s*=/);
  });

  it('audits only the failures', async () => {
    const db = dbWithLive([LIVE_A, LIVE_B]);
    await sweep(db, async (url) => ({ status: 200, body: url.endsWith('/a') ? HTML_A : 'wrong' }));

    const drifts = db.auditInserts().filter((a) => (a.params ?? []).includes('factory.live_site_drifted'));
    expect(drifts).toHaveLength(1);
    expect(String(drifts[0].params?.[4])).toContain('site-b');
  });
});

describe('the sweep rules', () => {
  const ref = { deploymentId: 'dep-a', siteId: 'site-a', domain: 'https://x/a', buildHash: HASH_A };

  it('classifies a matching read', () => {
    expect(classifyLive(ref, { status: 200, body: HTML_A })).toMatchObject({ verdict: 'match' });
  });

  it('classifies a missing address without reading anything', () => {
    expect(classifyLive({ ...ref, domain: '  ' }, null)).toMatchObject({ verdict: 'no_address' });
  });

  /**
   * An unreadable address is not healthy. Counting it as probably fine would
   * reproduce the silence that let the original defect last an hour.
   */
  it('does not count unreadable as healthy', () => {
    const entries: SweepEntry[] = [
      { deploymentId: 'a', siteId: 's', domain: 'u', verdict: 'unreadable', observed: null, approved: HASH_A, message: '' },
    ];
    expect(summariseSweep(entries)).toMatchObject({ checked: 1, matching: 0, healthy: false });
  });
});
