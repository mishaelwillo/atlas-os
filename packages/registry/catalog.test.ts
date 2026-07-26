import {
  existsSync,
  mkdtempSync,
  readFileSync,
  statSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Capability } from './registry.js';
import type { CapabilityMetadata } from './metadata.js';
import {
  renderCapabilityCatalog,
  resolveCatalogOutputPath,
  writeCapabilityCatalog,
} from './catalog.js';

const capabilities = [
  {
    id: 'zeta.action',
    name: 'Use *literal* [labels]',
    description: 'A | B',
    input: { type: 'object' },
    output: { type: 'object' },
    taskClass: 'quick',
    requiresApproval: false,
    scopes: [],
    method: 'GET',
  },
  {
    id: 'factory.build_site',
    name: 'Build wedge site',
    description: 'Build a sourced preview.',
    input: { type: 'object' },
    output: { type: 'object' },
    taskClass: 'do',
    requiresApproval: true,
    scopes: ['factory:write'],
    method: 'POST',
  },
  {
    id: 'alpha.action',
    name: 'Alpha',
    description: 'First by codepoint.',
    input: { type: 'object' },
    output: { type: 'object' },
    taskClass: 'quick',
    requiresApproval: false,
    scopes: [],
    method: 'GET',
  },
] satisfies Capability[];

const baseMetadata: CapabilityMetadata = {
  stage: 'candidate',
  phase: 'P2B',
  menuGroup: 'Website Factory',
  regions: ['global'],
  entitlements: ['website-factory'],
  monetization: 'acquisition',
  implementation: 'build',
  autonomy: 'manual',
  evidenceIds: ['evidence.site'],
  specification: 'docs/specs/p2/website-factory.md',
};

const metadata: Record<string, CapabilityMetadata> = {
  'zeta.action': {
    ...baseMetadata,
    menuGroup: 'Alpha & Ops',
    regions: ['usa', 'global'],
    entitlements: [],
    evidenceIds: [],
  },
  'factory.build_site': baseMetadata,
  'alpha.action': {
    ...baseMetadata,
    menuGroup: 'Alpha & Ops',
    evidenceIds: ['evidence.z', 'evidence.a'],
  },
};

describe('capability catalog', () => {
  it('renders complete executable metadata and the Website Factory example', () => {
    const catalog = renderCapabilityCatalog(capabilities, metadata);

    expect(catalog).toContain(`## Website Factory
### \`factory.build_site\` — Build wedge site
- Stage: candidate
- Phase: P2B
- Monetization: acquisition
- Autonomy: manual`);
    expect(catalog).toContain('- Implementation: build');
    expect(catalog).toContain('- Regions: `global`');
    expect(catalog).toContain('- Entitlements: `website-factory`');
    expect(catalog).toContain('- Evidence: `evidence.site`');
    expect(catalog).toContain(
      '- Specification: `docs/specs/p2/website-factory.md`',
    );
    expect(catalog).toContain('- Method: POST');
    expect(catalog).toContain('- Approval required: yes');
    expect(catalog).toContain('- Scopes: `factory:write`');
  });

  it('sorts groups, capability IDs, and metadata lists by codepoint', () => {
    const catalog = renderCapabilityCatalog(capabilities, metadata);

    expect(catalog.indexOf('## Alpha & Ops')).toBeLessThan(
      catalog.indexOf('## Website Factory'),
    );
    expect(catalog.indexOf('### `alpha.action`')).toBeLessThan(
      catalog.indexOf('### `zeta.action`'),
    );
    expect(catalog).toContain('- Regions: `global`, `usa`');
    expect(catalog).toContain('- Evidence: `evidence.a`, `evidence.z`');
  });

  it('is deterministic, timestamp-free, and escapes Markdown text', () => {
    const first = renderCapabilityCatalog(capabilities, metadata);
    const second = renderCapabilityCatalog(
      [...capabilities].reverse(),
      Object.fromEntries(Object.entries(metadata).reverse()),
    );

    expect(second).toBe(first);
    expect(first).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(first).toContain(
      '### `zeta.action` — Use \\*literal\\* \\[labels\\]',
    );
    expect(first).toContain('A \\| B');
  });

  it('rejects incomplete or extra metadata instead of publishing a false catalog', () => {
    expect(() =>
      renderCapabilityCatalog(capabilities, {
        ...metadata,
        'factory.build_site': undefined as unknown as CapabilityMetadata,
      }),
    ).toThrow(/missing metadata.*factory\.build_site/i);

    expect(() =>
      renderCapabilityCatalog(capabilities, {
        ...metadata,
        'candidate.not_executable': baseMetadata,
      }),
    ).toThrow(/non-executable metadata.*candidate\.not_executable/i);
  });

  it('writes exactly the rendered bytes to an explicit output atomically', () => {
    const directory = mkdtempSync(join(tmpdir(), 'atlas-catalog-'));
    const outputPath = join(directory, 'catalog.md');

    writeCapabilityCatalog(capabilities, metadata, outputPath);

    expect(readFileSync(outputPath, 'utf8')).toBe(
      renderCapabilityCatalog(capabilities, metadata),
    );
  });

  it('resolves the repository output independently of the process cwd', () => {
    const moduleUrl = new URL('./catalog.ts', import.meta.url);
    expect(resolveCatalogOutputPath(moduleUrl)).toBe(
      resolve(
        import.meta.dirname,
        '..',
        '..',
        'docs',
        'control',
        'generated',
        'capability-catalog.md',
      ),
    );
  });

  it('resolves and writes the tracked catalog from the compiled module', async () => {
    const packageRoot = import.meta.dirname;
    const repoRoot = resolve(packageRoot, '..', '..');
    const expected = resolve(
      repoRoot,
      'docs',
      'control',
      'generated',
      'capability-catalog.md',
    );
    const wrongPackagePath = resolve(
      repoRoot,
      'packages',
      'docs',
      'control',
      'generated',
      'capability-catalog.md',
    );
    const compiledPath = resolve(packageRoot, 'dist', 'catalog.js');
    const sourcePath = resolve(packageRoot, 'catalog.ts');
    if (
      !existsSync(compiledPath) ||
      statSync(compiledPath).mtimeMs < statSync(sourcePath).mtimeMs
    ) {
      execFileSync(
        process.execPath,
        [
          resolve(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc'),
          '--project',
          resolve(packageRoot, 'tsconfig.json'),
        ],
        { cwd: packageRoot, stdio: 'pipe' },
      );
    }
    const compiled = (await import(
      `${pathToFileURL(compiledPath).href}?compiled-path-test`
    )) as typeof import('./catalog.js');

    expect(compiled.resolveCatalogOutputPath()).toBe(expected);

    execFileSync(process.execPath, [compiledPath], {
      cwd: packageRoot,
      stdio: 'pipe',
    });
    expect(readFileSync(expected, 'utf8')).toBe(
      renderCapabilityCatalog(
        (await import('./registry.js')).registry,
        (await import('./metadata.js')).capabilityMetadata,
      ),
    );
    expect(existsSync(wrongPackagePath)).toBe(false);
  });

  it('fails loudly when no workspace root markers exist', () => {
    const directory = mkdtempSync(join(tmpdir(), 'atlas-no-workspace-'));
    expect(() =>
      resolveCatalogOutputPath(pathToFileURL(join(directory, 'catalog.js'))),
    ).toThrow(/workspace root/i);
  });
});
