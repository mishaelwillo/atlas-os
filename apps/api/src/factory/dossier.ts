/**
 * Research dossier → site descriptor (docs/specs/p2/website-factory.md).
 *
 * The spec's governing rule for this stage is "zero generated business fact
 * without a source or explicit owner entry". Everything here exists to make
 * that true by construction: a fact that cannot be traced never reaches the
 * descriptor, and a field with contradictory claims is blocked rather than
 * resolved by guessing which source is right.
 *
 * Pure and deterministic — no network, no clock, no database — so the same
 * dossier always yields the same descriptor.
 */

export interface RawFact {
  field?: unknown;
  value?: unknown;
  sourceUrl?: unknown;
  /** Owner-stated facts are admissible without a URL, but must say so. */
  ownerProvided?: unknown;
  confidence?: unknown;
}

export interface SourcedFact {
  field: string;
  value: string;
  /** Null only when the fact is owner-provided. */
  sourceUrl: string | null;
  ownerProvided: boolean;
  confidence: number | null;
}

export type BlockReason = 'unsourced' | 'conflicting' | 'malformed';

export interface BlockedField {
  field: string;
  reason: BlockReason;
  detail: string;
}

export interface Dossier {
  /** Facts admissible into the descriptor, one per field. */
  facts: SourcedFact[];
  /** Fields deliberately excluded; each must be resolved by a human. */
  blocked: BlockedField[];
}

const HTTP_URL = /^https?:\/\/[^\s]+$/i;

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/**
 * Partition supplied facts into admissible and blocked.
 *
 * A field appearing more than once with differing values is blocked outright.
 * Picking a winner would silently publish one source's claim over another's,
 * which is the failure the spec's conflict rule exists to prevent. Identical
 * repeats are not a conflict — they are corroboration.
 */
export function buildDossier(raw: readonly RawFact[]): Dossier {
  const byField = new Map<string, SourcedFact[]>();
  const blocked: BlockedField[] = [];

  for (const entry of raw) {
    const field = text(entry.field);
    const value = text(entry.value);
    if (!field) {
      blocked.push({ field: '(unnamed)', reason: 'malformed', detail: 'fact has no field name' });
      continue;
    }
    if (!value) {
      blocked.push({ field, reason: 'malformed', detail: 'fact has no value' });
      continue;
    }

    const sourceUrl = text(entry.sourceUrl);
    const ownerProvided = entry.ownerProvided === true;
    if (!ownerProvided && (!sourceUrl || !HTTP_URL.test(sourceUrl))) {
      blocked.push({
        field,
        reason: 'unsourced',
        detail: 'no source URL and not marked as owner-provided',
      });
      continue;
    }

    const confidence =
      typeof entry.confidence === 'number' && entry.confidence >= 0 && entry.confidence <= 1
        ? entry.confidence
        : null;

    const list = byField.get(field) ?? [];
    list.push({
      field,
      value,
      sourceUrl: ownerProvided ? sourceUrl : (sourceUrl as string),
      ownerProvided,
      confidence,
    });
    byField.set(field, list);
  }

  const facts: SourcedFact[] = [];
  for (const [field, candidates] of byField) {
    const distinct = new Set(candidates.map((c) => c.value));
    if (distinct.size > 1) {
      blocked.push({
        field,
        reason: 'conflicting',
        detail: `sources disagree: ${[...distinct].sort().join(' | ')}`,
      });
      continue;
    }
    facts.push(candidates[0]);
  }

  facts.sort((a, b) => (a.field < b.field ? -1 : a.field > b.field ? 1 : 0));
  blocked.sort((a, b) => (a.field < b.field ? -1 : a.field > b.field ? 1 : 0));
  return { facts, blocked };
}

export interface Descriptor {
  schemaVersion: 1;
  profileUrl: string;
  /** Region pack this site is built for; templates declare what they support. */
  region: string;
  template: string | null;
  stylePack: string | null;
  /** Every entry carries its provenance; the renderer needs no other source. */
  facts: SourcedFact[];
  blocked: BlockedField[];
}

/**
 * A descriptor is content plus provenance and nothing else — no raw model
 * output and no provider-specific fields, so the renderer stays graftable.
 */
export function buildDescriptor(args: {
  profileUrl: string;
  region?: string | null;
  template: string | null;
  stylePack: string | null;
  dossier: Dossier;
}): Descriptor {
  return {
    schemaVersion: 1,
    profileUrl: args.profileUrl,
    region: args.region?.trim() || 'global',
    template: args.template,
    stylePack: args.stylePack,
    facts: args.dossier.facts,
    blocked: args.dossier.blocked,
  };
}

/** The business name must itself be sourced; it is displayed like any other fact. */
export function businessNameFrom(dossier: Dossier): string | null {
  return dossier.facts.find((f) => f.field === 'businessName')?.value ?? null;
}
