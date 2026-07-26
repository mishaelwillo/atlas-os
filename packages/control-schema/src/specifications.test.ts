import { describe, expect, test } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { CapabilityCandidatesSchema } from './research.js';
import {
  assertRepositorySpecificationIntegrity,
  assertTraceabilityIntegrity,
} from './specifications.js';

const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url));

async function traceabilityInputs() {
  const [readme, catalog, candidateYaml] = await Promise.all([
    readFile(join(repositoryRoot, 'docs/specs/p2/README.md'), 'utf8'),
    readFile(join(repositoryRoot, 'docs/control/generated/capability-catalog.md'), 'utf8'),
    readFile(join(repositoryRoot, 'docs/control/CAPABILITY_CANDIDATES.yaml'), 'utf8'),
  ]);
  return {
    readme,
    catalog,
    candidates: CapabilityCandidatesSchema.parse(parse(candidateYaml)),
  };
}

function replaceOwner(readme: string, id: string, owner: string): string {
  return readme
    .split(/\r?\n/)
    .map((line) => {
      if (!line.startsWith(`| \`${id}\` |`)) return line;
      const cells = line.slice(1, -1).split('|').map((cell) => cell.trim());
      cells[4] = `\`${owner}\``;
      return `| ${cells.join(' | ')} |`;
    })
    .join('\n');
}

describe('P2 specification integrity', () => {
  test('the repository specification set is complete and evidence-backed', async () => {
    await expect(
      assertRepositorySpecificationIntegrity(fileURLToPath(new URL('../../..', import.meta.url))),
    ).resolves.toBeUndefined();
  });

  test('rejects an executable owner mismatch', async () => {
    const inputs = await traceabilityInputs();
    expect(() =>
      assertTraceabilityIntegrity(
        replaceOwner(inputs.readme, 'memory.answer', 'docs/specs/p2/intelligence-foundation.md'),
        inputs.catalog,
        inputs.candidates,
      ),
    ).toThrow(/memory\.answer.*owner/i);
  });

  test('rejects a candidate owner mismatch', async () => {
    const inputs = await traceabilityInputs();
    expect(() =>
      assertTraceabilityIntegrity(
        replaceOwner(inputs.readme, 'platform.dashboard', 'docs/specs/p2/website-factory.md'),
        inputs.catalog,
        inputs.candidates,
      ),
    ).toThrow(/platform\.dashboard.*owner/i);
  });

  test('rejects a duplicate traceability row', async () => {
    const inputs = await traceabilityInputs();
    const row = inputs.readme.match(/^\| `memory\.answer` \|.*$/m)?.[0];
    expect(row).toBeDefined();
    expect(() =>
      assertTraceabilityIntegrity(
        inputs.readme.replace(row!, `${row}\n${row}`),
        inputs.catalog,
        inputs.candidates,
      ),
    ).toThrow(/duplicate.*memory\.answer/i);
  });

  test('rejects a missing traceability row', async () => {
    const inputs = await traceabilityInputs();
    expect(() =>
      assertTraceabilityIntegrity(
        inputs.readme.replace(/^\| `memory\.answer` \|.*\r?\n/m, ''),
        inputs.catalog,
        inputs.candidates,
      ),
    ).toThrow(/missing.*memory\.answer/i);
  });

  test('rejects an extra traceability row', async () => {
    const inputs = await traceabilityInputs();
    expect(() =>
      assertTraceabilityIntegrity(
        `${inputs.readme}\n| \`unknown.extra\` | executable | P2A | build now | \`docs/specs/p2/README.md\` | — |\n`,
        inputs.catalog,
        inputs.candidates,
      ),
    ).toThrow(/extra.*unknown\.extra/i);
  });
});
