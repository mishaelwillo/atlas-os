/**
 * factory.build_site through the route pipeline
 * (docs/specs/p2/website-factory.md).
 */
import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { sha256hex } from './auth.js';
import { FakeDb, buildTestDeps, registerToken } from './test/fakes.js';

const TOKEN_PLAINTEXT = 'atlas_test_token_abc123';
const SPACE = '11111111-2222-3333-4444-555555555555';

function appWith(db: FakeDb): FastifyInstance {
  return buildApp({ deps: buildTestDeps(db) });
}

function dbReady(): FakeDb {
  const db = new FakeDb();
  registerToken(db, {
    spaceId: SPACE,
    label: 'factory',
    scopes: ['factory:write'],
    hash: sha256hex(TOKEN_PLAINTEXT),
  });
  db.when(/insert into sites/i, [{ site_id: 'site-1' }]);
  return db;
}

async function build(db: FakeDb, payload: Record<string, unknown>) {
  const res = await appWith(db).inject({
    method: 'POST',
    url: '/v1/factory/build_site',
    headers: { authorization: `Bearer ${TOKEN_PLAINTEXT}` },
    payload,
  });
  return { status: res.statusCode, body: res.json() };
}

function siteInsert(db: FakeDb) {
  return db.calls.find((c) => /insert into sites/i.test(c.sql));
}

const NAME = {
  field: 'businessName',
  value: 'Acme Plumbing',
  sourceUrl: 'https://maps.example/acme',
};

describe('factory.build_site', () => {
  // No template here: this case is about persistence and provenance. Template
  // satisfaction is covered separately below.
  it('creates a draft site from sourced facts', async () => {
    const db = dbReady();
    const { status, body } = await build(db, {
      profileUrl: 'https://maps.example/acme',
      facts: [NAME, { field: 'phone', value: '555-0100', sourceUrl: 'https://maps.example/acme' }],
    });

    expect(status).toBe(200);
    expect(body.siteId).toBe('site-1');
    expect(body.created).toBe(true);
    expect(body.status).toBe('descriptor_draft');
    expect(body.factCount).toBe(2);

    const params = siteInsert(db)?.params ?? [];
    expect(params[1]).toBe('Acme Plumbing');
    const descriptor = JSON.parse(String(params[2])) as { facts: Array<{ sourceUrl: string | null }> };
    expect(descriptor.facts).toHaveLength(2);
    expect(descriptor.facts.every((f) => f.sourceUrl !== null)).toBe(true);
  });

  /** No preview hosting exists yet, so none is claimed. */
  it('returns no previewUrl, since nothing has been generated', async () => {
    const db = dbReady();
    const { body } = await build(db, { profileUrl: 'https://maps.example/acme', facts: [NAME] });
    expect(body.previewUrl).toBeUndefined();
  });

  it('creates the site but flags gaps when a fact is unsourced', async () => {
    const db = dbReady();
    const { body } = await build(db, {
      profileUrl: 'https://maps.example/acme',
      facts: [NAME, { field: 'phone', value: '555-0100' }],
    });

    expect(body.created).toBe(true);
    expect(body.status).toBe('descriptor_draft_with_gaps');
    expect(body.factCount).toBe(1);
    expect(body.blocked).toEqual([
      { field: 'phone', reason: 'unsourced', detail: expect.any(String) },
    ]);
  });

  /**
   * A placeholder name would put an unsourced fact on the page, which is the
   * one thing this stage forbids — so nothing is created at all.
   */
  it('creates nothing when the business name was never sourced', async () => {
    const db = dbReady();
    const { status, body } = await build(db, {
      profileUrl: 'https://maps.example/acme',
      facts: [{ field: 'businessName', value: 'Acme Plumbing' }],
    });

    expect(status).toBe(200);
    expect(body.created).toBe(false);
    expect(body.status).toBe('facts_pending_review');
    expect(body.siteId).toBeUndefined();
    expect(siteInsert(db)).toBeUndefined();
  });

  it('creates nothing when no facts are supplied at all', async () => {
    const db = dbReady();
    const { body } = await build(db, { profileUrl: 'https://maps.example/acme' });
    expect(body.created).toBe(false);
    expect(siteInsert(db)).toBeUndefined();
  });

  it('rejects a missing profileUrl', async () => {
    const db = dbReady();
    const { status } = await build(db, { facts: [NAME] });
    expect(status).toBe(400);
  });

  it('audits the created site', async () => {
    const db = dbReady();
    await build(db, { profileUrl: 'https://maps.example/acme', facts: [NAME] });
    const audits = db.auditInserts();
    expect(audits.some((a) => (a.params ?? []).includes('factory.build_site'))).toBe(true);
  });
});

describe('factory.build_site rendering', () => {
  const complete = [
    NAME,
    { field: 'phone', value: '555-0100', sourceUrl: 'https://maps.example/acme' },
    { field: 'hours', value: 'Mon-Fri 9-5', sourceUrl: 'https://maps.example/acme' },
  ];

  it('returns a build hash when the template is satisfied', async () => {
    const db = dbReady();
    const { body } = await build(db, {
      profileUrl: 'https://maps.example/acme',
      template: 'trades-1',
      facts: complete,
    });

    expect(body.status).toBe('preview_built');
    expect(typeof body.buildHash).toBe('string');
    expect(String(body.buildHash)).toHaveLength(64);
    expect(body.renderIssues).toBeUndefined();
  });

  /** The research is still worth keeping when a template cannot be satisfied. */
  it('persists the descriptor and reports issues when the template is unsatisfied', async () => {
    const db = dbReady();
    const { body } = await build(db, {
      profileUrl: 'https://maps.example/acme',
      template: 'trades-1',
      facts: [NAME],
    });

    expect(body.created).toBe(true);
    expect(body.status).toBe('template_unsatisfied');
    expect(body.buildHash).toBeUndefined();
    const issues = body.renderIssues as Array<{ code: string; section?: string }>;
    expect(issues.map((i) => i.section).sort()).toEqual(['contact', 'hours']);
  });

  it('refuses a region the template is not approved for', async () => {
    const db = dbReady();
    const { body } = await build(db, {
      profileUrl: 'https://maps.example/acme',
      template: 'services-1',
      region: 'caribbean',
      facts: complete,
    });

    expect(body.status).toBe('template_unsatisfied');
    const issues = body.renderIssues as Array<{ code: string }>;
    expect(issues.map((i) => i.code)).toContain('region_unsupported');
  });

  it('stays a plain descriptor draft when no template is chosen', async () => {
    const db = dbReady();
    const { body } = await build(db, { profileUrl: 'https://maps.example/acme', facts: complete });
    expect(body.status).toBe('descriptor_draft');
    expect(body.buildHash).toBeUndefined();
  });
});
