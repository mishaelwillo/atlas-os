/**
 * Research dossier rules (docs/specs/p2/website-factory.md).
 * Governing acceptance: "zero generated business fact without a source or
 * explicit owner entry", and contradictory facts block the affected output.
 */
import { describe, expect, it } from 'vitest';
import { buildDescriptor, buildDossier, businessNameFrom } from './dossier.js';

const sourced = (field: string, value: string, sourceUrl = 'https://example.com/listing') => ({
  field,
  value,
  sourceUrl,
});

describe('fact sourcing', () => {
  it('admits a fact carrying a source URL', () => {
    const { facts, blocked } = buildDossier([sourced('businessName', 'Acme Plumbing')]);
    expect(blocked).toEqual([]);
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({ field: 'businessName', value: 'Acme Plumbing', ownerProvided: false });
  });

  /** The rule the whole stage exists to enforce. */
  it('blocks a fact with no source rather than rendering it', () => {
    const { facts, blocked } = buildDossier([{ field: 'phone', value: '555-0100' }]);
    expect(facts).toEqual([]);
    expect(blocked).toEqual([
      { field: 'phone', reason: 'unsourced', detail: expect.stringContaining('no source URL') },
    ]);
  });

  it('admits an owner-provided fact without a URL, but only when marked', () => {
    const { facts } = buildDossier([{ field: 'tagline', value: 'Fast and fair', ownerProvided: true }]);
    expect(facts).toHaveLength(1);
    expect(facts[0].ownerProvided).toBe(true);
    expect(facts[0].sourceUrl).toBeNull();
  });

  it('rejects a source that is not an http(s) URL', () => {
    const { blocked } = buildDossier([{ field: 'phone', value: '555-0100', sourceUrl: 'hearsay' }]);
    expect(blocked[0].reason).toBe('unsourced');
  });

  it('blocks malformed entries without a field or value', () => {
    const { facts, blocked } = buildDossier([
      { value: 'orphan', sourceUrl: 'https://example.com' },
      { field: 'hours', sourceUrl: 'https://example.com' },
    ]);
    expect(facts).toEqual([]);
    expect(blocked.map((b) => b.reason)).toEqual(['malformed', 'malformed']);
  });
});

describe('conflicting sources', () => {
  /**
   * Choosing a winner would silently publish one source's claim over another.
   * The field is withheld until a human resolves it.
   */
  it('blocks a field whose sources disagree', () => {
    const { facts, blocked } = buildDossier([
      sourced('phone', '555-0100', 'https://a.example/listing'),
      sourced('phone', '555-0199', 'https://b.example/listing'),
    ]);
    expect(facts).toEqual([]);
    expect(blocked[0]).toMatchObject({ field: 'phone', reason: 'conflicting' });
    expect(blocked[0].detail).toContain('555-0100');
    expect(blocked[0].detail).toContain('555-0199');
  });

  /** Repetition of the same value is corroboration, not disagreement. */
  it('admits a field two sources agree on', () => {
    const { facts, blocked } = buildDossier([
      sourced('phone', '555-0100', 'https://a.example/listing'),
      sourced('phone', '555-0100', 'https://b.example/listing'),
    ]);
    expect(blocked).toEqual([]);
    expect(facts).toHaveLength(1);
  });

  it('blocks only the disputed field, leaving the rest usable', () => {
    const { facts, blocked } = buildDossier([
      sourced('businessName', 'Acme Plumbing'),
      sourced('phone', '555-0100', 'https://a.example/x'),
      sourced('phone', '555-0199', 'https://b.example/x'),
    ]);
    expect(facts.map((f) => f.field)).toEqual(['businessName']);
    expect(blocked.map((b) => b.field)).toEqual(['phone']);
  });
});

describe('descriptor', () => {
  it('carries provenance for every displayed fact', () => {
    const dossier = buildDossier([sourced('businessName', 'Acme Plumbing')]);
    const descriptor = buildDescriptor({
      profileUrl: 'https://maps.example/acme',
      template: 'trades-1',
      stylePack: 'slate',
      dossier,
    });

    expect(descriptor.schemaVersion).toBe(1);
    expect(descriptor.facts.every((f) => f.sourceUrl !== null || f.ownerProvided)).toBe(true);
    expect(descriptor.blocked).toEqual([]);
  });

  /** Deterministic: the renderer must reproduce the same output from it. */
  it('is stable regardless of the order facts were supplied', () => {
    const a = buildDescriptor({
      profileUrl: 'https://maps.example/acme',
      template: null,
      stylePack: null,
      dossier: buildDossier([sourced('businessName', 'Acme'), sourced('phone', '555-0100')]),
    });
    const b = buildDescriptor({
      profileUrl: 'https://maps.example/acme',
      template: null,
      stylePack: null,
      dossier: buildDossier([sourced('phone', '555-0100'), sourced('businessName', 'Acme')]),
    });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('records blocked fields in the descriptor as visible gaps', () => {
    const dossier = buildDossier([
      sourced('businessName', 'Acme'),
      { field: 'phone', value: '555-0100' },
    ]);
    const descriptor = buildDescriptor({
      profileUrl: 'https://maps.example/acme',
      template: null,
      stylePack: null,
      dossier,
    });
    expect(descriptor.blocked).toHaveLength(1);
  });
});

describe('business name', () => {
  it('reads a sourced business name', () => {
    expect(businessNameFrom(buildDossier([sourced('businessName', 'Acme')]))).toBe('Acme');
  });

  it('returns null when the name itself was never sourced', () => {
    expect(businessNameFrom(buildDossier([{ field: 'businessName', value: 'Acme' }]))).toBeNull();
  });
});
