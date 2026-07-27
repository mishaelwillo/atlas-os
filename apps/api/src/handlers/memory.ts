/** memory.* handlers. Implemented now: memory.ingest. Rest: typed TODO stubs. */
import { createHash } from 'node:crypto';
import { CapabilityError, type CapabilityHandler } from '../pipeline.js';

interface IngestCard {
  title?: unknown;
  body?: unknown;
  source?: unknown;
  sourceType?: unknown;
  tags?: unknown;
  relevanceScore?: unknown;
  scoreReasons?: unknown;
  // P2A enrichment (0002_intelligence_enrichment). All optional: a card
  // without them behaves exactly as it did in P1.
  locale?: unknown;
  region?: unknown;
  retention?: unknown;
  correlationId?: unknown;
}

const SOURCE_TYPES = new Set(['own-output', 'primary-doc', 'external', 'vendor-content']);
const RETENTION_CLASSES = new Set(['standard', 'sensitive', 'ephemeral', 'legal-hold']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Trimmed string, or null when absent or blank. */
function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/**
 * memory.ingest — hash-dedupe upsert into memory_cards + ingest_queue
 * transitions. The unique index on (space, content_hash) makes re-ingest of
 * unchanged content a no-op (incremental ingest contract).
 */
export const memoryIngest: CapabilityHandler = async (ctx, input) => {
  const cards = input.cards as unknown[];
  let admitted = 0;
  let skipped = 0;
  let quarantined = 0;

  for (const [i, raw] of cards.entries()) {
    const card = raw as IngestCard;
    if (typeof card.title !== 'string' || typeof card.body !== 'string' || typeof card.source !== 'string') {
      throw new CapabilityError(400, `cards[${i}]: title, body and source are required strings`);
    }
    const sourceType = typeof card.sourceType === 'string' && SOURCE_TYPES.has(card.sourceType) ? card.sourceType : 'external';
    const tags = Array.isArray(card.tags) ? card.tags.filter((t): t is string => typeof t === 'string') : [];
    const relevance = typeof card.relevanceScore === 'number' ? Math.trunc(card.relevanceScore) : 0;
    const reasons = Array.isArray(card.scoreReasons)
      ? card.scoreReasons.filter((r): r is string => typeof r === 'string')
      : [];
    const contentHash = createHash('sha256').update(`${card.title}\n${card.body}`, 'utf8').digest('hex');

    const locale = optionalText(card.locale);
    // Null means unresolved, not global — the region pack is never inferred here.
    const region = optionalText(card.region);
    const retention =
      typeof card.retention === 'string' && RETENTION_CLASSES.has(card.retention)
        ? card.retention
        : 'standard';
    // A malformed correlation id is dropped rather than failing the card: it is
    // a tracing aid, not a claim about the content.
    const correlationRaw = optionalText(card.correlationId);
    const correlationId = correlationRaw && UUID.test(correlationRaw) ? correlationRaw : null;

    /*
     * A blank source passes the type check above and used to enter the bank
     * looking like any other card. Such a card cannot be traced to anything, so
     * it is admitted for review rather than trusted — the spec's rule that
     * source-free claims are quarantined.
     */
    const sourceFree = (card.source as string).trim() === '';
    const quarantineReason = sourceFree ? 'source-free: no traceable origin' : null;

    const inserted = await ctx.q.query(
      `insert into memory_cards
         (space_id, title, body, source, source_type, tags, relevance_score, score_reasons, content_hash,
          locale, region, retention, correlation_id, quarantined_at, quarantine_reason)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9,
               $10, $11, $12::retention_class, $13, $14, $15)
       on conflict do nothing
       returning card_id`,
      [
        ctx.spaceId, card.title, card.body, card.source, sourceType, tags, relevance, reasons, contentHash,
        locale, region, retention, correlationId,
        sourceFree ? new Date().toISOString() : null,
        quarantineReason,
      ],
    );

    const wasInserted = (inserted.rowCount ?? 0) > 0;
    if (!wasInserted) skipped += 1;
    else if (sourceFree) quarantined += 1;
    else admitted += 1;

    // Queue transition. The card is in the bank whether THIS call inserted it
    // or an earlier identical one did — either way the content is admitted, so
    // a hash-dedupe skip must NOT flip the queue row to 'rejected'. 'rejected'
    // is reserved for real relevance filtering (P2). Same (source,hash) is a
    // no-op on re-ingest, preserving the original processed_at. A quarantined
    // card stays 'pending' instead: held for review, not admitted.
    await ctx.q.query(
      `insert into ingest_queue (space_id, source_path, content_hash, status, relevance_score, processed_at, reject_reason)
       values ($1, $2, $3, $5, $4, now(), $6)
       on conflict (source_path, content_hash) do nothing`,
      [
        ctx.spaceId,
        card.source,
        contentHash,
        relevance,
        sourceFree ? 'pending' : 'admitted',
        quarantineReason,
      ],
    );
  }

  return { admitted, skipped, quarantined };
};

/** memory.answer — token-ladder (cache → playbook → nodes → model). TODO(P2). */
export const memoryAnswer: CapabilityHandler = async () => {
  throw new CapabilityError(501, 'memory.answer: token-ladder not implemented in P1 (see brief §2 stub list)');
};

/** memory.distill — cards → decision-memory nodes. TODO(P2, scheduled). */
export const memoryDistill: CapabilityHandler = async () => {
  throw new CapabilityError(501, 'memory.distill: distillation not implemented in P1');
};
