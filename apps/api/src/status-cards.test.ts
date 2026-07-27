/**
 * Mission Control drift and memory-freshness cards
 * (docs/specs/p2/intelligence-foundation.md): "Mission Control exposes P1
 * deployment drift and does not suppress unknowns."
 */
import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { deploymentFindings } from './handlers/status.js';
import { FakeDb, buildTestDeps, operatorJwt, testEnv } from './test/fakes.js';

function appWith(db: FakeDb): FastifyInstance {
  return buildApp({ deps: buildTestDeps(db) });
}

async function cards(db: FakeDb): Promise<Record<string, Record<string, unknown>>> {
  const res = await appWith(db).inject({
    method: 'GET',
    url: '/v1/status/mission_control',
    headers: { authorization: `Bearer ${operatorJwt(testEnv())}` },
  });
  expect(res.statusCode).toBe(200);
  const body = res.json<{ cards: Array<{ id: string; data: Record<string, unknown> }> }>();
  return Object.fromEntries(body.cards.map((c) => [c.id, c.data]));
}

describe('deployment findings', () => {
  it('reports nothing when the deployment and database agree', () => {
    expect(deploymentFindings('0002_intelligence_enrichment', '0002_intelligence_enrichment')).toEqual([]);
  });

  /** The defect this closes: a stale-but-well-formed claim passing unnoticed. */
  it('flags a stale schema claim as blocking', () => {
    const [finding] = deploymentFindings('0001_init', '0002_intelligence_enrichment');
    expect(finding.severity).toBe('blocking');
    expect(finding.code).toBe('deployment.schema_mismatch');
    expect(finding.message).toContain('0001_init');
    expect(finding.message).toContain('0002_intelligence_enrichment');
  });

  it('reports an unreadable database as unknown rather than agreement', () => {
    const [finding] = deploymentFindings('0002_intelligence_enrichment', null);
    expect(finding.severity).toBe('unknown');
    expect(finding.code).toBe('database.migration_unknown');
  });

  it('reports an undeclared service schema as unknown, not a mismatch', () => {
    const [finding] = deploymentFindings('unknown', '0002_intelligence_enrichment');
    expect(finding.severity).toBe('unknown');
    expect(finding.code).toBe('service.schema_unknown');
  });
});

describe('mission control deployment card', () => {
  it('publishes the fingerprint and a clean result when the database agrees', async () => {
    const db = new FakeDb();
    db.when(/schema_migrations/i, [{ migration_identity: '0002_intelligence_enrichment' }]);

    const data = (await cards(db)).deployment;
    expect(data.observedMigration).toBe('0002_intelligence_enrichment');
    expect(data.findings).toEqual([]);
    expect((data.service as Record<string, unknown>).gitSha).toBe('abc1234');
  });

  /**
   * The query must be allowed to fail without taking the whole card set with
   * it — an operator needs the rest of Mission Control precisely when
   * something is wrong.
   */
  it('degrades to unknown when the migration ledger cannot be read', async () => {
    const db = new FakeDb();
    db.when(/schema_migrations/i, () => {
      throw new Error('relation "supabase_migrations.schema_migrations" does not exist');
    });

    const all = await cards(db);
    expect(all.deployment.observedMigration).toBeNull();
    expect((all.deployment.findings as Array<{ severity: string }>)[0].severity).toBe('unknown');
    // The rest of the dashboard still rendered.
    expect(all.approvals).toBeDefined();
    expect(all.runs).toBeDefined();
  });
});

describe('mission control memory card', () => {
  it('summarises card counts, quarantine, and node truth status', async () => {
    const db = new FakeDb();
    db.when(/from memory_cards/i, [
      { cards: 12, quarantined: 2, newest: '2026-07-27T00:00:00.000Z' },
    ]);
    db.when(/from memory_nodes/i, [
      { truth_status: 'verified', n: 5 },
      { truth_status: 'quarantined', n: 1 },
    ]);

    const data = (await cards(db)).memory;
    expect(data.cards).toBe(12);
    expect(data.quarantined).toBe(2);
    expect(data.newestCardAt).toBe('2026-07-27T00:00:00.000Z');
    expect(data.nodesByTruthStatus).toEqual({ verified: 5, quarantined: 1 });
  });

  /** An empty bank must read as empty, not as fresh. */
  it('reports a null newest card when nothing has been ingested', async () => {
    const db = new FakeDb();
    db.when(/from memory_cards/i, [{ cards: 0, quarantined: 0, newest: null }]);

    const data = (await cards(db)).memory;
    expect(data.cards).toBe(0);
    expect(data.newestCardAt).toBeNull();
  });
});
