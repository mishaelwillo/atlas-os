import { access, readFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { parse } from 'yaml';
import {
  CapabilityCandidatesSchema,
  ResearchLedgerSchema,
  type CapabilityCandidates,
} from './research.js';

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

interface TraceabilityRow {
  id: string;
  kind: string;
  owner: string;
  target?: string;
}

function unquoteCell(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith('`') && trimmed.endsWith('`')
    ? trimmed.slice(1, -1)
    : trimmed;
}

function parseTraceabilityRows(readme: string): TraceabilityRow[] {
  const section = /^## Durable capability traceability\s*$([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(
    readme,
  )?.[1];
  if (!section) throw new Error('missing Durable capability traceability section');

  const tableLines = section
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('|'));
  if (tableLines.length < 2) throw new Error('traceability table is missing');

  const headers = tableLines[0]
    .slice(1, -1)
    .split('|')
    .map((cell) => cell.trim());
  const idIndex = headers.indexOf('Capability/candidate');
  const kindIndex = headers.indexOf('Kind');
  const ownerIndex = headers.indexOf('Owner specification');
  const targetIndex = headers.indexOf('P2 target/delta specification');
  if (idIndex < 0 || kindIndex < 0 || ownerIndex < 0 || targetIndex < 0) {
    throw new Error('traceability table has invalid authority columns');
  }

  return tableLines.slice(2).map((line) => {
    const cells = line
      .slice(1, -1)
      .split('|')
      .map((cell) => cell.trim());
    if (cells.length !== headers.length) {
      throw new Error(`invalid traceability row: ${line}`);
    }
    const target = unquoteCell(cells[targetIndex]);
    return {
      id: unquoteCell(cells[idIndex]),
      kind: unquoteCell(cells[kindIndex]),
      owner: unquoteCell(cells[ownerIndex]),
      target: target === '—' || target === '-' ? undefined : target,
    };
  });
}

function executableOwners(catalog: string): Map<string, string> {
  const owners = new Map<string, string>();
  const headings = [...catalog.matchAll(/^### `([^`]+)`[^\r\n]*$/gm)];
  for (const [index, heading] of headings.entries()) {
    const start = heading.index + heading[0].length;
    const end = headings[index + 1]?.index ?? catalog.length;
    const block = catalog.slice(start, end);
    const owner = /^- Specification: `([^`]+)`$/m.exec(block)?.[1];
    if (!owner) throw new Error(`catalog capability ${heading[1]} has no owner specification`);
    owners.set(heading[1], owner);
  }
  return owners;
}

export function assertTraceabilityIntegrity(
  readme: string,
  catalog: string,
  candidates: CapabilityCandidates,
): string[] {
  const executable = executableOwners(catalog);
  const candidate = new Map(
    candidates.candidates.map((item) => [item.id, item.specification]),
  );
  // Pinned deliberately: adding an executable capability is a governance
  // event, so the count must be changed knowingly rather than drifting.
  // 23 as of P2C outreach sequence state.
  if (executable.size !== 23) {
    throw new Error(`expected exactly 23 executable capabilities, found ${executable.size}`);
  }
  if (candidate.size !== 31) {
    throw new Error(`expected exactly 31 capability candidates, found ${candidate.size}`);
  }

  const expected = new Map<string, { kind: 'executable' | 'candidate'; owner: string }>([
    ...[...executable].map(
      ([id, owner]) => [id, { kind: 'executable' as const, owner }] as const,
    ),
    ...[...candidate].map(
      ([id, owner]) => [id, { kind: 'candidate' as const, owner }] as const,
    ),
  ]);
  const seen = new Set<string>();
  const targetPaths = new Set<string>();

  for (const row of parseTraceabilityRows(readme)) {
    if (seen.has(row.id)) throw new Error(`duplicate traceability row ${row.id}`);
    seen.add(row.id);
    const authority = expected.get(row.id);
    if (!authority) throw new Error(`extra traceability row ${row.id}`);
    if (row.kind !== authority.kind) {
      throw new Error(
        `${row.id} kind mismatch: expected ${authority.kind}, found ${row.kind}`,
      );
    }
    if (row.owner !== authority.owner) {
      throw new Error(
        `${row.id} owner specification mismatch: expected ${authority.owner}, found ${row.owner}`,
      );
    }
    if (row.target) targetPaths.add(row.target);
  }

  for (const id of expected.keys()) {
    if (!seen.has(id)) throw new Error(`missing traceability row ${id}`);
  }
  return [...targetPaths];
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
  const readme = await readFile(join(root, 'docs/specs/p2/README.md'), 'utf8');
  for (const targetPath of assertTraceabilityIntegrity(readme, catalog, candidates)) {
    referencedSpecifications.add(targetPath);
  }
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
