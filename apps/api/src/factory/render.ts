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

function renderSection(template: Template, sectionId: string, facts: Map<string, SourcedFact>): string {
  const section = template.sections.find((s) => s.id === sectionId);
  if (!section) return '';
  const fields = [...section.requires, ...(section.optional ?? [])];
  const parts = fields
    .map((field) => facts.get(field))
    .filter((f): f is SourcedFact => f !== undefined)
    .map((f) => `      ${renderFact(f)}`);
  return [
    `    <section id="${escapeHtml(sectionId)}">`,
    ...parts,
    '    </section>',
  ].join('\n');
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

  const html = [
    '<!doctype html>',
    '<html lang="en">',
    '  <head>',
    '    <meta charset="utf-8">',
    '    <meta name="viewport" content="width=device-width, initial-scale=1">',
    // Previews must never be indexed; publishing is a separate, approved step.
    '    <meta name="robots" content="noindex,nofollow">',
    `    <title>${title}</title>`,
    '    <style>',
    '      :root {',
    tokenCss,
    '      }',
    '      body { background: var(--surface); color: var(--text); font-family: system-ui, sans-serif; }',
    '      .src { margin-left: .4rem; font-size: .75rem; color: var(--accent); }',
    '    </style>',
    '  </head>',
    '  <body>',
    `    <main data-template="${escapeHtml(template.id)}" data-template-version="${template.version}" data-region="${escapeHtml(region)}">`,
    ...template.sections.map((s) => renderSection(template, s.id, facts)),
    '    </main>',
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
  };
}
