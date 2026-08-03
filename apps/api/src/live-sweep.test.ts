/**
 * Scheduled live-site verification (docs/specs/p2/website-factory.md).
 *
 * The sweep only helps if it runs without anyone remembering to run it. These
 * tests pin that it runs the real capability — not a model prompt — and that
 * one bad space does not stop the others being checked.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SWEEP_INTERVAL_MS,
  MIN_SWEEP_INTERVAL_MS,
  runLiveSweepTick,
  sweepIntervalMs,
} from './live-sweep.js';
import { FakeDb, buildTestDeps } from './test/fakes.js';
import { sha256 } from './factory/fingerprint.js';

const SPACE_A = '11111111-2222-3333-4444-555555555555';
const SPACE_B = '22222222-3333-4444-5555-666666666666';
const HTML = '<html>Acme</html>';
const HASH = sha256(HTML);

function dbWith(spaces: string[], live: Array<Record<string, unknown>>): FakeDb {
  const db = new FakeDb();
  db.when(/select distinct space_id from site_deployments/i, spaces.map((s) => ({ space_id: s })));
  db.when(/from site_deployments\s+where status = 'live'/i, live);
  return db;
}

const LIVE = {
  deployment_id: 'dep-a',
  site_id: 'site-a',
  domain: 'https://sites.example/a',
  build_hash: HASH,
};

describe('sweepIntervalMs', () => {
  it('defaults when nothing is configured', () => {
    expect(sweepIntervalMs(undefined)).toBe(DEFAULT_SWEEP_INTERVAL_MS);
    expect(sweepIntervalMs('  ')).toBe(DEFAULT_SWEEP_INTERVAL_MS);
  });

  it('defaults rather than failing on an unreadable value', () => {
    expect(sweepIntervalMs('soon')).toBe(DEFAULT_SWEEP_INTERVAL_MS);
    expect(sweepIntervalMs('1.5')).toBe(DEFAULT_SWEEP_INTERVAL_MS);
  });

  /** A one-second sweep would be a self-inflicted load test on customer sites. */
  it('refuses an interval short enough to hammer published sites', () => {
    expect(sweepIntervalMs('1000')).toBe(MIN_SWEEP_INTERVAL_MS);
    expect(sweepIntervalMs('0')).toBe(MIN_SWEEP_INTERVAL_MS);
  });

  it('accepts a sensible override', () => {
    expect(sweepIntervalMs(String(15 * 60 * 1000))).toBe(15 * 60 * 1000);
  });
});

describe('a sweep tick', () => {
  it('checks every space that has something live', async () => {
    const db = dbWith([SPACE_A, SPACE_B], [LIVE]);
    const deps = { ...buildTestDeps(db), readPublic: async () => ({ status: 200, body: HTML }) };

    const result = await runLiveSweepTick(deps);
    expect(result).toMatchObject({ spaces: 2, checked: 2, drifted: 0, failures: 0 });
  });

  /** A space with nothing published has nothing to verify. */
  it('does nothing when nothing is live anywhere', async () => {
    const db = dbWith([], []);
    const deps = { ...buildTestDeps(db), readPublic: async () => ({ status: 200, body: HTML }) };

    expect(await runLiveSweepTick(deps)).toMatchObject({ spaces: 0, checked: 0 });
  });

  it('counts a site that stopped serving its approved build', async () => {
    const db = dbWith([SPACE_A], [LIVE]);
    const deps = { ...buildTestDeps(db), readPublic: async () => ({ status: 404, body: '' }) };

    const result = await runLiveSweepTick(deps);
    expect(result).toMatchObject({ spaces: 1, checked: 1, drifted: 1, failures: 0 });
  });

  /**
   * It runs the capability, not a model prompt. If it went through
   * runs.execute the router would answer and no deployment would be read.
   */
  it('runs the real check rather than asking a model', async () => {
    const db = dbWith([SPACE_A], [LIVE]);
    const reads: string[] = [];
    const deps = {
      ...buildTestDeps(db),
      readPublic: async (url: string) => {
        reads.push(url);
        return { status: 200, body: HTML };
      },
    };

    await runLiveSweepTick(deps);
    expect(reads).toEqual(['https://sites.example/a']);
    expect(db.calls.some((c) => /update site_deployments/i.test(c.sql))).toBe(true);
    expect(db.calls.some((c) => /insert into runs/i.test(c.sql))).toBe(false);
  });

  /** An unreachable tenant is when the remaining ones most need checking. */
  it('keeps going when one space fails', async () => {
    const db = new FakeDb();
    db.when(/select distinct space_id from site_deployments/i, [
      { space_id: SPACE_A },
      { space_id: SPACE_B },
    ]);
    let call = 0;
    db.when(/from site_deployments\s+where status = 'live'/i, () => {
      call += 1;
      if (call === 1) throw new Error('connection reset');
      return [LIVE];
    });
    const deps = { ...buildTestDeps(db), readPublic: async () => ({ status: 200, body: HTML }) };

    const result = await runLiveSweepTick(deps);
    expect(result).toMatchObject({ spaces: 2, failures: 1, checked: 1 });
  });

  it('does nothing when the capability is not registered', async () => {
    const db = dbWith([SPACE_A], [LIVE]);
    const deps = buildTestDeps(db);
    const without = { ...deps, capabilities: { ...deps.capabilities } };
    delete without.capabilities['factory.verify_live'];

    expect(await runLiveSweepTick(without)).toMatchObject({ spaces: 0, checked: 0 });
  });
});
