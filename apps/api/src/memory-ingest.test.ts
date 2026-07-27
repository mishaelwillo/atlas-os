/**
 * memory.ingest P2A enrichment (docs/specs/p2/intelligence-reconciliation.md).
 * Every new field is optional, so a P1-shaped card must behave exactly as it
 * did before. Source-free cards are held for review rather than entering the
 * bank looking trustworthy.
 */
import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { sha256hex } from './auth.js';
import { FakeDb, buildTestDeps, registerToken } from './test/fakes.js';

const TOKEN_PLAINTEXT = 'atlas_test_token_abc123';
const SPACE = '11111111-2222-3333-4444-555555555555';

/** Column order of the memory_cards insert, as parameter indexes. */
const CARD = {
  source: 3,
  locale: 9,
  region: 10,
  retention: 11,
  correlationId: 12,
  quarantinedAt: 13,
  quarantineReason: 14,
} as const;
/** Column order of the ingest_queue insert. */
const QUEUE = { status: 4, reason: 5 } as const;

function appWith(db: FakeDb): FastifyInstance {
  return buildApp({ deps: buildTestDeps(db) });
}

/** A db whose card insert reports one row, i.e. the card was newly stored. */
function dbAdmitting(): FakeDb {
  const db = new FakeDb();
  registerToken(db, {
    spaceId: SPACE,
    label: 'ingest',
    scopes: ['memory:write'],
    hash: sha256hex(TOKEN_PLAINTEXT),
  });
  db.when(/insert into memory_cards/i, [{ card_id: 'card-1' }]);
  return db;
}

async function ingest(db: FakeDb, cards: unknown[]) {
  const res = await appWith(db).inject({
    method: 'POST',
    url: '/v1/memory/ingest',
    headers: { authorization: `Bearer ${TOKEN_PLAINTEXT}` },
    payload: { cards },
  });
  return { status: res.statusCode, body: res.json() as Record<string, number> };
}

function cardInsert(db: FakeDb) {
  return db.calls.find((c) => /insert into memory_cards/i.test(c.sql));
}
function queueInsert(db: FakeDb) {
  return db.calls.find((c) => /insert into ingest_queue/i.test(c.sql));
}

const BASE = { title: 'T', body: 'B', source: 'run:test' };

describe('memory.ingest enrichment', () => {
  it('persists the supplied provenance fields', async () => {
    const db = dbAdmitting();
    const { status, body } = await ingest(db, [
      {
        ...BASE,
        locale: ' en-US ',
        region: 'north-america',
        retention: 'sensitive',
        correlationId: '3f6d1c9e-6a2b-4c1d-9f7e-1a2b3c4d5e6f',
      },
    ]);

    expect(status).toBe(200);
    expect(body).toEqual({ admitted: 1, skipped: 0, quarantined: 0 });
    const params = cardInsert(db)?.params ?? [];
    expect(params[CARD.locale]).toBe('en-US');
    expect(params[CARD.region]).toBe('north-america');
    expect(params[CARD.retention]).toBe('sensitive');
    expect(params[CARD.correlationId]).toBe('3f6d1c9e-6a2b-4c1d-9f7e-1a2b3c4d5e6f');
  });

  /** Backward compatibility: the P1 card shape must not change behaviour. */
  it('defaults every new field when a P1-shaped card is ingested', async () => {
    const db = dbAdmitting();
    const { body } = await ingest(db, [BASE]);

    expect(body).toEqual({ admitted: 1, skipped: 0, quarantined: 0 });
    const params = cardInsert(db)?.params ?? [];
    expect(params[CARD.locale]).toBeNull();
    expect(params[CARD.region]).toBeNull();
    expect(params[CARD.retention]).toBe('standard');
    expect(params[CARD.correlationId]).toBeNull();
    expect(params[CARD.quarantinedAt]).toBeNull();
  });

  it('falls back to standard retention for an unrecognised class', async () => {
    const db = dbAdmitting();
    await ingest(db, [{ ...BASE, retention: 'forever' }]);
    expect((cardInsert(db)?.params ?? [])[CARD.retention]).toBe('standard');
  });

  /** A tracing aid must never invalidate the content it accompanies. */
  it('drops a malformed correlation id without rejecting the card', async () => {
    const db = dbAdmitting();
    const { body } = await ingest(db, [{ ...BASE, correlationId: 'not-a-uuid' }]);
    expect(body.admitted).toBe(1);
    expect((cardInsert(db)?.params ?? [])[CARD.correlationId]).toBeNull();
  });

  it('treats a blank region as unresolved rather than global', async () => {
    const db = dbAdmitting();
    await ingest(db, [{ ...BASE, region: '   ' }]);
    expect((cardInsert(db)?.params ?? [])[CARD.region]).toBeNull();
  });
});

describe('memory.ingest quarantine', () => {
  it('quarantines a source-free card instead of admitting it', async () => {
    const db = dbAdmitting();
    const { status, body } = await ingest(db, [{ title: 'T', body: 'B', source: '   ' }]);

    expect(status).toBe(200);
    expect(body).toEqual({ admitted: 0, skipped: 0, quarantined: 1 });
    const params = cardInsert(db)?.params ?? [];
    expect(params[CARD.quarantinedAt]).not.toBeNull();
    expect(params[CARD.quarantineReason]).toMatch(/source-free/);
  });

  /** 'rejected' stays reserved for relevance filtering, so held cards pend. */
  it('holds a quarantined card as pending in the ingest queue', async () => {
    const db = dbAdmitting();
    await ingest(db, [{ title: 'T', body: 'B', source: '' }]);
    const params = queueInsert(db)?.params ?? [];
    expect(params[QUEUE.status]).toBe('pending');
    expect(params[QUEUE.reason]).toMatch(/source-free/);
  });

  it('admits a sourced card to the queue with no reason recorded', async () => {
    const db = dbAdmitting();
    await ingest(db, [BASE]);
    const params = queueInsert(db)?.params ?? [];
    expect(params[QUEUE.status]).toBe('admitted');
    expect(params[QUEUE.reason]).toBeNull();
  });

  it('still rejects a structurally invalid card with 400', async () => {
    const db = dbAdmitting();
    const { status } = await ingest(db, [{ title: 'T', body: 'B' }]);
    expect(status).toBe(400);
  });

  it('counts a hash-deduped card as skipped, not quarantined', async () => {
    const db = new FakeDb();
    registerToken(db, {
      spaceId: SPACE,
      label: 'ingest',
      scopes: ['memory:write'],
      hash: sha256hex(TOKEN_PLAINTEXT),
    });
    // No responder for memory_cards: the insert reports zero rows, as a
    // conflicting content hash would.
    const { body } = await ingest(db, [BASE]);
    expect(body).toEqual({ admitted: 0, skipped: 1, quarantined: 0 });
  });

  it('separates the counters across a mixed batch', async () => {
    const db = dbAdmitting();
    const { body } = await ingest(db, [
      BASE,
      { title: 'T2', body: 'B2', source: '' },
      { title: 'T3', body: 'B3', source: 'run:test' },
    ]);
    expect(body).toEqual({ admitted: 2, skipped: 0, quarantined: 1 });
  });
});
