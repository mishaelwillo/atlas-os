/**
 * Deterministic renderer (docs/specs/p2/website-factory.md).
 *
 * Generation is deterministic from descriptor + template + tokens: the same
 * inputs must always produce byte-identical output, because publishing
 * promotes exactly the hash that was approved. Nothing here may read the
 * clock, a random source, or the environment.
 *
 * Fact values originate from third-party listings, so every interpolated
 * value is escaped. A business name is untrusted input, not markup.
 */
import { createHash } from 'node:crypto';
import type { Descriptor, SourcedFact } from './dossier.js';
import { findTemplate, validateCombination, type CombinationIssue, type Template } from './templates.js';

/** Escapes the five characters that can break out of text or an attribute. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface RenderResult {
  html: string;
  /** sha256 of the html; the fingerprint publishing promotes. */
  hash: string;
  templateId: string;
  templateVersion: number;
  /** Sections actually rendered, in template order. */
  sections: string[];
  /** The template's design tokens, so QA can judge them without re-parsing CSS. */
  tokens: Readonly<Record<string, string>>;
}

export interface RenderRefusal {
  rendered: false;
  issues: CombinationIssue[];
}

export type RenderOutcome = (RenderResult & { rendered: true }) | RenderRefusal;

function factMap(facts: readonly SourcedFact[]): Map<string, SourcedFact> {
  return new Map(facts.map((f) => [f.field, f]));
}

/**
 * Provenance is rendered alongside the value, not stripped. Every displayed
 * business fact is source-linked, which is the dossier stage's guarantee
 * carried through to the page.
 */
function renderFact(fact: SourcedFact): string {
  const value = escapeHtml(fact.value);
  if (fact.ownerProvided) {
    return `<span class="fact" data-field="${escapeHtml(fact.field)}">${value}<span class="src">owner-provided</span></span>`;
  }
  const href = escapeHtml(fact.sourceUrl ?? '');
  return `<span class="fact" data-field="${escapeHtml(fact.field)}">${value}<a class="src" href="${href}" rel="nofollow noopener">source</a></span>`;
}

/**
 * Schema.org properties the renderer may emit, keyed by descriptor fact field.
 *
 * Only fields with an unambiguous property are mapped. Structured data is read
 * by search engines as claims about the business, so a field whose meaning
 * would have to be guessed is left out rather than asserted under an
 * approximate property.
 */
export const STRUCTURED_DATA_PROPERTIES: Readonly<Record<string, string>> = {
  businessName: 'name',
  phone: 'telephone',
  email: 'email',
  address: 'address',
  hours: 'openingHours',
  tagline: 'slogan',
};

/**
 * The one section that carries the page's `h1`: the section that displays the
 * business name. A document needs exactly one top-level heading, and the
 * business name is the only honest candidate.
 */
function primarySectionId(template: Template): string | null {
  return template.sections.find((s) => s.requires.includes('businessName'))?.id ?? null;
}

function renderSection(
  template: Template,
  sectionId: string,
  facts: Map<string, SourcedFact>,
  primaryId: string | null,
): string {
  const section = template.sections.find((s) => s.id === sectionId);
  if (!section) return '';
  const isPrimary = section.id === primaryId;
  const fields = [...section.requires, ...(section.optional ?? [])];
  const parts = fields
    .map((field) => facts.get(field))
    .filter((f): f is SourcedFact => f !== undefined)
    .map((f) =>
      // The business name is the h1 rather than a heading repeating it, so the
      // name is still source-linked exactly once.
      isPrimary && f.field === 'businessName'
        ? `      <h1 id="${escapeHtml(sectionId)}-heading">${renderFact(f)}</h1>`
        : `      ${renderFact(f)}`,
    );
  const heading = isPrimary
    ? []
    : [`      <h2 id="${escapeHtml(sectionId)}-heading">${escapeHtml(section.title)}</h2>`];
  return [
    `    <section id="${escapeHtml(sectionId)}" aria-labelledby="${escapeHtml(sectionId)}-heading">`,
    ...heading,
    ...parts,
    '    </section>',
  ].join('\n');
}

/**
 * JSON-LD restating the sourced facts — never adding to them.
 *
 * `<` `>` and `&` are unicode-escaped so no fact value can close the script
 * element, which is the one way a data block can become executable markup.
 */
function renderStructuredData(facts: Map<string, SourcedFact>): string {
  const payload: Record<string, string> = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
  };
  for (const [field, property] of Object.entries(STRUCTURED_DATA_PROPERTIES).sort(
    ([, a], [, b]) => (a < b ? -1 : a > b ? 1 : 0),
  )) {
    const fact = facts.get(field);
    if (fact) payload[property] = fact.value;
  }
  return JSON.stringify(payload).replace(/[<>&]/g, (c) =>
    c === '<' ? '\\u003c' : c === '>' ? '\\u003e' : '\\u0026',
  );
}

/**
 * Render a descriptor with its template, or refuse with the reasons.
 *
 * Refusal happens before any markup is produced, so an invalid combination
 * cannot yield a partial page that looks publishable.
 */
export function renderSite(descriptor: Descriptor): RenderOutcome {
  const templateId = descriptor.template ?? '';
  const region = descriptor.region ?? 'global';
  const facts = factMap(descriptor.facts);

  const issues = validateCombination({
    templateId,
    region,
    availableFacts: descriptor.facts.map((f) => f.field),
  });
  if (issues.length > 0) return { rendered: false, issues };

  // validateCombination already proved the template exists.
  const template = findTemplate(templateId) as Template;

  const tokenCss = Object.entries(template.tokens)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `      --${escapeHtml(k)}: ${escapeHtml(v)};`)
    .join('\n');

  const name = facts.get('businessName');
  const title = escapeHtml(name?.value ?? 'Untitled');
  const primaryId = primarySectionId(template);

  const html = [
    '<!doctype html>',
    '<html lang="en">',
    '  <head>',
    '    <meta charset="utf-8">',
    '    <meta name="viewport" content="width=device-width, initial-scale=1">',
    // Previews must never be indexed; publishing is a separate, approved step.
    '    <meta name="robots" content="noindex,nofollow">',
    /*
     * The page needs nothing from anywhere: no scripts, no fonts, no images,
     * no form posts. Saying so in a policy makes that a rule the browser
     * enforces rather than a property of today's template that a later one
     * could quietly lose.
     */
    '    <meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src \'self\'; base-uri \'none\'; form-action \'none\'">',
    `    <title>${title}</title>`,
    '    <style>',
    '      :root {',
    tokenCss,
    '      }',
    '      body { background: var(--surface); color: var(--text); font-family: system-ui, sans-serif; }',
    '      main { max-width: 42rem; margin: 0 auto; padding: 1rem; }',
    '      .src { margin-left: .4rem; font-size: .75rem; color: var(--accent); }',
    '      .fact { display: block; margin: .25rem 0; }',
    '    </style>',
    `    <script type="application/ld+json">${renderStructuredData(facts)}</script>`,
    '  </head>',
    '  <body>',
    `    <main data-template="${escapeHtml(template.id)}" data-template-version="${template.version}" data-region="${escapeHtml(region)}">`,
    ...template.sections.map((s) => renderSection(template, s.id, facts, primaryId)),
    '    </main>',
    /*
     * The privacy notice states what this build actually does, which is
     * nothing: it is generated from the same markup that carries no scripts,
     * cookies or third-party requests, so the claim stays true by
     * construction rather than by promise.
     */
    '    <footer data-privacy-notice>',
    '      This page collects no personal information: it runs no scripts, stores no',
    '      cookies, and loads nothing from another site.',
    '    </footer>',
    '  </body>',
    '</html>',
    '',
  ].join('\n');

  return {
    rendered: true,
    html,
    hash: createHash('sha256').update(html, 'utf8').digest('hex'),
    templateId: template.id,
    templateVersion: template.version,
    sections: template.sections.map((s) => s.id),
    tokens: template.tokens,
  };
}
