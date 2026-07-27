/**
 * Template library (docs/specs/p2/website-factory.md).
 *
 * Templates are declarative: a template says which vertical and regions it
 * serves, which facts each of its sections needs, and which tokens it exposes.
 * It contains no markup decisions the renderer cannot reproduce from the
 * descriptor alone.
 *
 * The spec's acceptance for this stage is that invalid component/region
 * combinations fail *before* build, so every check here runs against the
 * descriptor without rendering anything.
 */

export interface SectionContract {
  id: string;
  /** Facts this section cannot render without. */
  requires: readonly string[];
  /** Facts it will use when present. */
  optional?: readonly string[];
}

export interface Template {
  id: string;
  version: number;
  vertical: string;
  /** Region pack ids this layout is approved for. */
  regions: readonly string[];
  sections: readonly SectionContract[];
  tokens: Readonly<Record<string, string>>;
}

export const TEMPLATE_LIBRARY: readonly Template[] = [
  {
    id: 'trades-1',
    version: 1,
    vertical: 'trades',
    regions: ['global', 'north-america', 'caribbean'],
    sections: [
      { id: 'hero', requires: ['businessName'], optional: ['tagline'] },
      { id: 'contact', requires: ['phone'], optional: ['email', 'address'] },
      { id: 'hours', requires: ['hours'] },
    ],
    tokens: { accent: '#1f6feb', surface: '#ffffff', text: '#101418' },
  },
  {
    id: 'services-1',
    version: 1,
    vertical: 'services',
    regions: ['global', 'north-america'],
    sections: [
      { id: 'hero', requires: ['businessName'], optional: ['tagline'] },
      { id: 'services', requires: ['services'] },
      { id: 'contact', requires: ['phone'], optional: ['email'] },
    ],
    tokens: { accent: '#0f766e', surface: '#ffffff', text: '#101418' },
  },
] as const;

export function findTemplate(id: string): Template | null {
  return TEMPLATE_LIBRARY.find((t) => t.id === id) ?? null;
}

export type CombinationIssueCode =
  | 'template_unknown'
  | 'region_unsupported'
  | 'section_facts_missing';

export interface CombinationIssue {
  code: CombinationIssueCode;
  detail: string;
  /** Section that cannot be satisfied, when the issue is section-scoped. */
  section?: string;
  /** Facts the section needed but does not have. */
  missing?: string[];
}

/**
 * Decide whether a descriptor may be built with a template, before rendering.
 *
 * A section whose required facts are missing is an error rather than a section
 * quietly omitted: the template author declared those facts necessary for the
 * layout to make sense, and silently dropping it would publish a page that
 * looks intact but is not the one that was designed.
 */
export function validateCombination(args: {
  templateId: string;
  region: string;
  availableFacts: readonly string[];
}): CombinationIssue[] {
  const template = findTemplate(args.templateId);
  if (!template) {
    return [{ code: 'template_unknown', detail: `no template '${args.templateId}' in the library` }];
  }

  const issues: CombinationIssue[] = [];
  if (!template.regions.includes(args.region)) {
    issues.push({
      code: 'region_unsupported',
      detail: `template '${template.id}' is not approved for region '${args.region}' (approved: ${template.regions.join(', ')})`,
    });
  }

  const have = new Set(args.availableFacts);
  for (const section of template.sections) {
    const missing = section.requires.filter((f) => !have.has(f));
    if (missing.length > 0) {
      issues.push({
        code: 'section_facts_missing',
        section: section.id,
        missing,
        detail: `section '${section.id}' requires ${missing.join(', ')}`,
      });
    }
  }

  return issues;
}
