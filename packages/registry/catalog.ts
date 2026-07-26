import {
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join, parse, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { capabilityMetadata, type CapabilityMetadata } from './metadata.js';
import { registry, type Capability } from './registry.js';

const CATALOG_HEADER = `# Atlas Executable Capability Catalog

This file is generated from the executable Atlas capability registry and its
typed lifecycle metadata. An item listed only in the research or candidate
ledgers is not executable and does not appear here.
`;

function compareCodepoints(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function escapeMarkdownText(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/([\\`*_[\]{}()<>#+\-.!|])/g, '\\$1');
}

function codeSpan(value: string): string {
  const longestBacktickRun = Math.max(
    0,
    ...Array.from(value.matchAll(/`+/g), (match) => match[0].length),
  );
  const fence = '`'.repeat(longestBacktickRun + 1);
  const padding = value.startsWith('`') || value.endsWith('`') ? ' ' : '';
  return `${fence}${padding}${value}${padding}${fence}`;
}

function renderList(values: readonly string[]): string {
  if (values.length === 0) return 'none';
  return [...values].sort(compareCodepoints).map(codeSpan).join(', ');
}

function validateCoverage(
  capabilities: readonly Capability[],
  metadata: Readonly<Record<string, CapabilityMetadata>>,
): void {
  const ids = capabilities.map(({ id }) => id);
  const uniqueIds = new Set(ids);
  if (uniqueIds.size !== ids.length) {
    const duplicate = [...ids]
      .sort(compareCodepoints)
      .find((id, index, sorted) => index > 0 && sorted[index - 1] === id);
    throw new Error(`Duplicate executable capability: ${duplicate}`);
  }

  for (const id of [...ids].sort(compareCodepoints)) {
    if (!metadata[id]) {
      throw new Error(`Missing metadata for executable capability: ${id}`);
    }
  }

  const extras = Object.keys(metadata)
    .filter((id) => !uniqueIds.has(id))
    .sort(compareCodepoints);
  if (extras.length > 0) {
    throw new Error(
      `Non-executable metadata cannot enter the capability catalog: ${extras.join(', ')}`,
    );
  }
}

function renderCapability(
  capability: Capability,
  metadata: CapabilityMetadata,
): string {
  return `### ${codeSpan(capability.id)} — ${escapeMarkdownText(capability.name)}
- Stage: ${metadata.stage}
- Phase: ${metadata.phase}
- Monetization: ${metadata.monetization}
- Autonomy: ${metadata.autonomy}
- Implementation: ${metadata.implementation}
- Regions: ${renderList(metadata.regions)}
- Entitlements: ${renderList(metadata.entitlements)}
- Evidence: ${renderList(metadata.evidenceIds)}
- Specification: ${codeSpan(metadata.specification)}
- Method: ${capability.method}
- Task class: ${capability.taskClass}
- Approval required: ${capability.requiresApproval ? 'yes' : 'no'}
- Scopes: ${renderList(capability.scopes)}
- Description: ${escapeMarkdownText(capability.description)}
`;
}

export function renderCapabilityCatalog(
  capabilities: readonly Capability[],
  metadata: Readonly<Record<string, CapabilityMetadata>>,
): string {
  validateCoverage(capabilities, metadata);

  const groups = new Map<string, Capability[]>();
  for (const capability of capabilities) {
    const group = metadata[capability.id].menuGroup;
    const entries = groups.get(group) ?? [];
    entries.push(capability);
    groups.set(group, entries);
  }

  const sections = [...groups.entries()]
    .sort(([left], [right]) => compareCodepoints(left, right))
    .map(([group, entries]) => {
      const capabilitiesInGroup = [...entries]
        .sort((left, right) => compareCodepoints(left.id, right.id))
        .map((capability) =>
          renderCapability(capability, metadata[capability.id]),
        )
        .join('\n');
      return `## ${escapeMarkdownText(group)}\n${capabilitiesInGroup}`;
    });

  return `${CATALOG_HEADER}\n${sections.join('\n')}`.trimEnd() + '\n';
}

export function resolveCatalogOutputPath(
  moduleUrl: URL | string = import.meta.url,
): string {
  const moduleDirectory = dirname(fileURLToPath(moduleUrl));
  let repoRoot = resolve(moduleDirectory);
  const filesystemRoot = parse(repoRoot).root;

  while (
    !(
      existsSync(join(repoRoot, 'pnpm-workspace.yaml')) &&
      existsSync(join(repoRoot, 'package.json'))
    )
  ) {
    if (repoRoot === filesystemRoot) {
      throw new Error(
        `Unable to find Atlas workspace root from ${moduleDirectory}`,
      );
    }
    repoRoot = dirname(repoRoot);
  }

  return join(
    repoRoot,
    'docs',
    'control',
    'generated',
    'capability-catalog.md',
  );
}

export function writeCapabilityCatalog(
  capabilities: readonly Capability[],
  metadata: Readonly<Record<string, CapabilityMetadata>>,
  outputPath: string = resolveCatalogOutputPath(),
): void {
  const rendered = renderCapabilityCatalog(capabilities, metadata);
  const outputDirectory = dirname(outputPath);
  const temporaryPath = join(
    outputDirectory,
    `.${randomUUID()}.capability-catalog.tmp`,
  );

  mkdirSync(outputDirectory, { recursive: true });
  try {
    writeFileSync(temporaryPath, rendered, 'utf8');
    renameSync(temporaryPath, outputPath);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

function isMainModule(): boolean {
  const entryPoint = process.argv[1];
  if (!entryPoint) return false;
  return pathToFileURL(resolve(entryPoint)).href === import.meta.url;
}

if (isMainModule()) {
  const outputPath = resolveCatalogOutputPath();
  writeCapabilityCatalog(registry, capabilityMetadata, outputPath);
  console.log(`catalog: wrote ${outputPath} (${registry.length} capabilities)`);
}
