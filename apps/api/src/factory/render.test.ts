/**
 * Template validation and deterministic rendering
 * (docs/specs/p2/website-factory.md). Governing acceptances: invalid
 * component/region combinations fail before build, and descriptor/template
 * versions reproduce the same render.
 */
import { describe, expect, it } from 'vitest';
import { buildDescriptor, buildDossier } from './dossier.js';
import { escapeHtml, renderSite } from './render.js';
import { findTemplate, validateCombination } from './templates.js';

const SRC = 'https://maps.example/acme';
const fact = (field: string, value: string) => ({ field, value, sourceUrl: SRC });

/** A dossier satisfying every required section of trades-1. */
function tradesDescriptor(overrides: { region?: string; template?: string | null } = {}) {
  return buildDescriptor({
    profileUrl: SRC,
    region: overrides.region ?? 'global',
    template: overrides.template === undefined ? 'trades-1' : overrides.template,
    stylePack: null,
    dossier: buildDossier([
      fact('businessName', 'Acme Plumbing'),
      fact('phone', '555-0100'),
      fact('hours', 'Mon-Fri 9-5'),
    ]),
  });
}

describe('template combination validation', () => {
  it('accepts an approved template, region, and complete fact set', () => {
    expect(
      validateCombination({
        templateId: 'trades-1',
        region: 'caribbean',
        availableFacts: ['businessName', 'phone', 'hours'],
      }),
    ).toEqual([]);
  });

  it('rejects an unknown template', () => {
    const [issue] = validateCombination({ templateId: 'nope', region: 'global', availableFacts: [] });
    expect(issue.code).toBe('template_unknown');
  });

  /** Region packs gate which layouts are approved where. */
  it('rejects a region the template is not approved for', () => {
    const issues = validateCombination({
      templateId: 'services-1',
      region: 'caribbean',
      availableFacts: ['businessName', 'services', 'phone'],
    });
    expect(issues.map((i) => i.code)).toContain('region_unsupported');
    expect(issues[0].detail).toContain('caribbean');
  });

  /**
   * A section short of its required facts is an error, not a silent omission:
   * dropping it would publish a page that looks intact but is not the one the
   * template author designed.
   */
  it('names the section and the facts it is missing', () => {
    const issues = validateCombination({
      templateId: 'trades-1',
      region: 'global',
      availableFacts: ['businessName'],
    });
    const missing = issues.filter((i) => i.code === 'section_facts_missing');
    expect(missing).toHaveLength(2);
    expect(missing.map((i) => i.section).sort()).toEqual(['contact', 'hours']);
    expect(missing.find((i) => i.section === 'contact')?.missing).toEqual(['phone']);
  });

  it('does not require optional facts', () => {
    expect(
      validateCombination({
        templateId: 'trades-1',
        region: 'global',
        availableFacts: ['businessName', 'phone', 'hours'],
      }),
    ).toEqual([]);
  });
});

describe('render refusal', () => {
  it('produces no markup at all when the combination is invalid', () => {
    const outcome = renderSite(tradesDescriptor({ region: 'antarctica' }));
    expect(outcome.rendered).toBe(false);
    expect(outcome).not.toHaveProperty('html');
  });

  it('refuses when no template was chosen', () => {
    const outcome = renderSite(tradesDescriptor({ template: null }));
    expect(outcome.rendered).toBe(false);
  });
});

describe('deterministic render', () => {
  it('produces identical bytes and hash for identical input', () => {
    const a = renderSite(tradesDescriptor());
    const b = renderSite(tradesDescriptor());
    expect(a.rendered && b.rendered).toBe(true);
    if (!a.rendered || !b.rendered) return;
    expect(a.html).toBe(b.html);
    expect(a.hash).toBe(b.hash);
  });

  it('changes the hash when a fact changes', () => {
    const a = renderSite(tradesDescriptor());
    const b = renderSite(
      buildDescriptor({
        profileUrl: SRC,
        region: 'global',
        template: 'trades-1',
        stylePack: null,
        dossier: buildDossier([
          fact('businessName', 'Acme Plumbing'),
          fact('phone', '555-0199'),
          fact('hours', 'Mon-Fri 9-5'),
        ]),
      }),
    );
    if (!a.rendered || !b.rendered) throw new Error('expected both to render');
    expect(a.hash).not.toBe(b.hash);
  });

  it('records the template identity and its version in the markup', () => {
    const outcome = renderSite(tradesDescriptor());
    if (!outcome.rendered) throw new Error('expected a render');
    expect(outcome.html).toContain('data-template="trades-1"');
    expect(outcome.html).toContain('data-template-version="1"');
    expect(outcome.templateVersion).toBe(findTemplate('trades-1')?.version);
  });

  /** A preview must never be indexed; publishing is a separate approved step. */
  it('marks the output noindex', () => {
    const outcome = renderSite(tradesDescriptor());
    if (!outcome.rendered) throw new Error('expected a render');
    expect(outcome.html).toContain('content="noindex,nofollow"');
  });

  it('carries a source link for every displayed fact', () => {
    const outcome = renderSite(tradesDescriptor());
    if (!outcome.rendered) throw new Error('expected a render');
    const factSpans = outcome.html.match(/class="fact"/g) ?? [];
    const sources = outcome.html.match(/class="src"/g) ?? [];
    expect(factSpans.length).toBe(3);
    expect(sources.length).toBe(factSpans.length);
  });

  it('labels an owner-provided fact instead of linking a source', () => {
    const descriptor = buildDescriptor({
      profileUrl: SRC,
      region: 'global',
      template: 'trades-1',
      stylePack: null,
      dossier: buildDossier([
        fact('businessName', 'Acme Plumbing'),
        fact('phone', '555-0100'),
        { field: 'hours', value: 'By appointment', ownerProvided: true },
      ]),
    });
    const outcome = renderSite(descriptor);
    if (!outcome.rendered) throw new Error('expected a render');
    expect(outcome.html).toContain('owner-provided');
  });
});

describe('escaping untrusted fact values', () => {
  it('escapes the characters that break out of text or attributes', () => {
    expect(escapeHtml(`<script>"&'`)).toBe('&lt;script&gt;&quot;&amp;&#39;');
  });

  /** Fact values come from third-party listings; they are input, not markup. */
  it('neutralises a script payload in a business name', () => {
    const descriptor = buildDescriptor({
      profileUrl: SRC,
      region: 'global',
      template: 'trades-1',
      stylePack: null,
      dossier: buildDossier([
        fact('businessName', '<script>alert(1)</script>'),
        fact('phone', '555-0100'),
        fact('hours', 'Mon-Fri'),
      ]),
    });
    const outcome = renderSite(descriptor);
    if (!outcome.rendered) throw new Error('expected a render');
    expect(outcome.html).not.toContain('<script>alert(1)</script>');
    expect(outcome.html).toContain('&lt;script&gt;');
  });

  it('neutralises an attribute break in a source URL', () => {
    const descriptor = buildDescriptor({
      profileUrl: SRC,
      region: 'global',
      template: 'trades-1',
      stylePack: null,
      dossier: buildDossier([
        { field: 'businessName', value: 'Acme', sourceUrl: 'https://x.example/"onload="alert(1)' },
        fact('phone', '555-0100'),
        fact('hours', 'Mon-Fri'),
      ]),
    });
    const outcome = renderSite(descriptor);
    if (!outcome.rendered) throw new Error('expected a render');
    expect(outcome.html).not.toContain('onload="alert(1)"');
    expect(outcome.html).toContain('&quot;onload=');
  });
});
