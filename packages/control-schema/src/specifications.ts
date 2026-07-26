import { access, readFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { parse } from 'yaml';
import { CapabilityCandidatesSchema, ResearchLedgerSchema } from './research.js';

const REQUIRED_SPECIFICATIONS = [
  'docs/specs/p2/README.md',
  'docs/specs/p2/regional-packs.md',
  'docs/specs/p2/intelligence-foundation.md',
  'docs/specs/p2/website-factory.md',
  'docs/specs/p2/revenue-pilot.md',
  'docs/specs/p2/upsell-capabilities.md',
] as const;

const REQUIRED_HEADINGS = [
  'Purpose',
  'Users',
  'Inputs and outputs',
  'UI and menu',
  'Workflow and states',
  'Data entities',
  'APIs, events, and integrations',
  'Permissions, approvals, and autonomy',
  'Regional behavior',
  'Entitlement and monetization',
  'Evidence',
  'Analytics',
  'Errors and recovery',
  'Security and privacy',
  'MVP exclusions',
  'Acceptance tests',
  'Progressive integration',
] as const;

const STAGING_TERMS = [
  'build now',
  'integrate now',
  'build later',
  'exclude pending evidence',
] as const;

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function safeRepositoryPath(root: string, repositoryPath: string): string {
  const target = resolve(root, repositoryPath);
  const remainder = relative(root, target);
  if (
    isAbsolute(repositoryPath) ||
    remainder === '..' ||
    remainder.startsWith(`..${sep}`) ||
    isAbsolute(remainder)
  ) {
    throw new Error(`unsafe specification path: ${repositoryPath}`);
  }
  return target;
}

export async function assertRepositorySpecificationIntegrity(root: string): Promise<void> {
  const ledger = ResearchLedgerSchema.parse(
    parse(await readFile(join(root, 'docs/control/RESEARCH_LEDGER.yaml'), 'utf8')),
  );
  const candidates = CapabilityCandidatesSchema.parse(
    parse(await readFile(join(root, 'docs/control/CAPABILITY_CANDIDATES.yaml'), 'utf8')),
  );
  const evidenceIds = new Set(ledger.evidence.map((item) => item.id));
  const referencedSpecifications = new Set<string>([
    ...REQUIRED_SPECIFICATIONS,
    ...ledger.evidence.map((item) => item.specification),
    ...candidates.candidates.map((item) => item.specification),
  ]);

  const catalog = await readFile(
    join(root, 'docs/control/generated/capability-catalog.md'),
    'utf8',
  );
  for (const match of catalog.matchAll(/^- Specification: `([^`]+)`$/gm)) {
    referencedSpecifications.add(match[1]);
  }

  for (const repositoryPath of referencedSpecifications) {
    const target = safeRepositoryPath(root, repositoryPath);
    if (!(await exists(target))) {
      throw new Error(`missing referenced specification: ${repositoryPath}`);
    }
  }

  for (const repositoryPath of REQUIRED_SPECIFICATIONS) {
    const markdown = await readFile(safeRepositoryPath(root, repositoryPath), 'utf8');
    for (const heading of REQUIRED_HEADINGS) {
      if (!new RegExp(`^##+ ${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm').test(markdown)) {
        throw new Error(`${repositoryPath} is missing heading: ${heading}`);
      }
    }
    for (const term of STAGING_TERMS) {
      if (!markdown.toLowerCase().includes(term)) {
        throw new Error(`${repositoryPath} is missing staging term: ${term}`);
      }
    }
  }

  for (const candidate of candidates.candidates) {
    for (const evidenceId of candidate.evidence_ids) {
      if (!evidenceIds.has(evidenceId)) {
        throw new Error(`${candidate.id} references unknown evidence ${evidenceId}`);
      }
    }
  }

  for (const match of catalog.matchAll(/^- Evidence: (.+)$/gm)) {
    if (match[1] === 'none') continue;
    for (const evidenceId of match[1].split(',').map((value) => value.trim().replaceAll('`', ''))) {
      if (!evidenceIds.has(evidenceId)) {
        throw new Error(`capability catalog references unknown evidence ${evidenceId}`);
      }
    }
  }

  const crosswalk = await readFile(join(root, 'docs/specs/p2/menu-crosswalk.md'), 'utf8');
  for (const record of ledger.evidence.filter(
    (item) => item.verification === 'observed' && item.observed_labels,
  )) {
    for (const label of record.observed_labels ?? []) {
      if (!crosswalk.includes(`\`${label}\``)) {
        throw new Error(`crosswalk is missing observed label ${label} from ${record.id}`);
      }
    }
  }

  const aiAgentRecord = ledger.evidence.find(
    (item) => item.id === 'video-qy0l1t7x6le-ai-agent-tabs',
  );
  if (
    !aiAgentRecord ||
    aiAgentRecord.verification !== 'needs_research' ||
    !/AI-agent sub-tabs remain\s+pending research/.test(crosswalk)
  ) {
    throw new Error('crosswalk must preserve the AI-agent sub-tab evidence gap');
  }
}
