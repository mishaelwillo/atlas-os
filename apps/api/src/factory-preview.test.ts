/**
 * factory.preview (docs/specs/p2/website-factory.md): "Preview uses immutable
 * build, access/expiry, feedback, and noindex."
 */
import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { sha256hex } from './auth.js';
import { buildDescriptor, buildDossier } from './factory/dossier.js';
import { renderSite } from './factory/render.js';
import { PREVIEW_TTL_MS, previewExpiry } from './handlers/factory.js';
import { FakeDb, buildTestDeps, registerToken } from './test/fakes.js';

const TOKEN_PLAINTEXT = 'atlas_test_token_abc123';
const SPACE = '11111111-2222-3333-4444-555555555555';
const SITE = '99999999-8888-7777-6666-555555555555';
const SRC = 'https://maps.example/acme';

const fact = (field: string, value: string) => ({ field, value, sourceUrl: SRC });

function descriptor() {
  return buildDescriptor({
    profileUrl: SRC,
    region: 'global',
    template: 'trades-1',
    stylePack: null,
    dossier: buildDossier([
      fact('businessName', 'Acme Plumbing'),
      fact('phone', '555-0100'),
      fact('hours', 'Mon-Fri 9-5'),
    ]),
  });
}

function appWith(db: FakeDb): FastifyInstance {
  return buildApp({ deps: buildTestDeps(db) });
}

function dbWithSite(updatedAt: Date, stored: unknown = descriptor()): FakeDb {
  const db = new FakeDb();
  registerToken(db, {
    spaceId: SPACE,
    label: 'factory',
    scopes: ['factory:write'],
    hash: sha256hex(TOKEN_PLAINTEXT),
  });
  db.when(/from sites where site_id/i, [
    { site_id: SITE, descriptor: stored, updated_at: updatedAt.toISOString() },
  ]);
  return db;
}

async function preview(db: FakeDb, siteId = SITE) {
  const res = await appWith(db).inject({
    method: 'GET',
    url: `/v1/factory/preview?siteId=${encodeURIComponent(siteId)}`,
    headers: { authorization: `Bearer ${TOKEN_PLAINTEXT}` },
  });
  return { status: res.statusCode, body: res.json() };
}

describe('preview access', () => {
  it('requires authentication', async () => {
    const db = dbWithSite(new Date());
    const res = await appWith(db).inject({
      method: 'GET',
      url: `/v1/factory/preview?siteId=${SITE}`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 404 for a site the caller cannot see', async () => {
    const db = new FakeDb();
    registerToken(db, {
      spaceId: SPACE,
      label: 'factory',
      scopes: ['factory:write'],
      hash: sha256hex(TOKEN_PLAINTEXT),
    });
    // No responder: RLS yields no row, exactly as a foreign site would.
    const { status } = await preview(db);
    expect(status).toBe(404);
  });

  it('rejects a missing siteId', async () => {
    const db = dbWithSite(new Date());
    const res = await appWith(db).inject({
      method: 'GET',
      url: '/v1/factory/preview',
      headers: { authorization: `Bearer ${TOKEN_PLAINTEXT}` },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('preview expiry', () => {
  it('adds the TTL to the build time', () => {
    const built = new Date('2026-07-01T00:00:00.000Z');
    expect(previewExpiry(built).toISOString()).toBe(
      new Date(built.getTime() + PREVIEW_TTL_MS).toISOString(),
    );
  });

  it('serves a fresh build', async () => {
    const { body } = await preview(dbWithSite(new Date()));
    expect(body.expired).toBe(false);
    expect(typeof body.html).toBe('string');
  });

  /** An expired preview yields no markup at all, not merely a warning. */
  it('withholds the build once expired', async () => {
    const stale = new Date(Date.now() - PREVIEW_TTL_MS - 1000);
    const { body } = await preview(dbWithSite(stale));
    expect(body.expired).toBe(true);
    expect(body.html).toBeUndefined();
    expect(body.hash).toBeUndefined();
  });
});

describe('immutable build', () => {
  /**
   * The build is re-rendered rather than stored, so a stored copy can never
   * drift from the descriptor it claims to represent.
   */
  it('reproduces exactly the hash the renderer produces', async () => {
    const direct = renderSite(descriptor());
    if (!direct.rendered) throw new Error('expected a render');

    const { body } = await preview(dbWithSite(new Date()));
    expect(body.hash).toBe(direct.hash);
    expect(body.html).toBe(direct.html);
  });

  /**
   * Postgres jsonb does not preserve object key order. If rendering depended
   * on it, previews would drift after a round-trip — so assert stability
   * against a deliberately reordered descriptor.
   */
  it('is stable when jsonb returns the descriptor with reordered keys', async () => {
    const original = descriptor();
    const reordered = JSON.parse(
      JSON.stringify({
        blocked: original.blocked,
        facts: original.facts,
        template: original.template,
        region: original.region,
        stylePack: original.stylePack,
        profileUrl: original.profileUrl,
        schemaVersion: original.schemaVersion,
      }),
    ) as unknown;

    const direct = renderSite(original);
    if (!direct.rendered) throw new Error('expected a render');
    const { body } = await preview(dbWithSite(new Date(), reordered));
    expect(body.hash).toBe(direct.hash);
  });

  it('marks the preview noindex', async () => {
    const { body } = await preview(dbWithSite(new Date()));
    expect(String(body.html)).toContain('content="noindex,nofollow"');
  });

  it('reports issues instead of markup when the template is unsatisfied', async () => {
    const thin = buildDescriptor({
      profileUrl: SRC,
      region: 'global',
      template: 'trades-1',
      stylePack: null,
      dossier: buildDossier([fact('businessName', 'Acme Plumbing')]),
    });
    const { body } = await preview(dbWithSite(new Date(), thin));

    expect(body.html).toBeUndefined();
    expect((body.issues as unknown[]).length).toBeGreaterThan(0);
  });
});
