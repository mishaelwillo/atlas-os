import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  CapabilityStageSchema,
  DriftSeveritySchema,
  EnvironmentFileSchema,
  WorkQueueSchema,
  WorkStatusSchema,
} from './schemas.js';
import { loadControlFiles } from './load.js';
import { runStaticVerificationCli, verifyStatic } from './verify-static.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const validEnvironment = {
  schema_version: 1,
  environments: {
    production: {
      github: { repository: 'example/atlas', branch: 'main' },
      supabase: {
        project_ref: 'public-project-ref',
        expected_migration: '0001_init',
        required_tables: ['spaces'],
      },
      railway: {
        api: { public_url: 'https://api.example.test', health_path: '/healthz' },
        os: { public_url: 'https://os.example.test', health_path: '/build-info.json' },
      },
      required_variable_names: ['DATABASE_URL'],
    },
  },
};

const validQueue = {
  schema_version: 1,
  items: [
    {
      id: 'P2A-CONTROL-001',
      phase: 'P2A',
      title: 'Validate control artifacts',
      status: 'in_progress',
      priority: 'critical',
      dependencies: [],
      specification: 'CONTINUITY_DESIGN.md',
      acceptance_checks: ['Static verification passes'],
      next_action: 'Run the verifier',
    },
  ],
};

async function makeControlRoot(options?: {
  queue?: unknown;
  handoff?: string;
  index?: string;
  environment?: unknown;
  includeSpecification?: boolean;
}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'atlas-control-'));
  temporaryRoots.push(root);
  const control = join(root, 'docs', 'control');
  await mkdir(control, { recursive: true });
  await mkdir(join(control, 'regions'), { recursive: true });
  await writeFile(join(control, 'ENVIRONMENTS.yaml'), JSON.stringify(options?.environment ?? validEnvironment));
  await writeFile(join(control, 'WORK_QUEUE.yaml'), JSON.stringify(options?.queue ?? validQueue));
  await writeFile(
    join(control, 'CURRENT_HANDOFF.md'),
    options?.handoff ?? '# Current Handoff\n\n- Work item: `P2A-CONTROL-001`\n',
  );
  await writeFile(
    join(control, 'CONTROL_INDEX.md'),
    options?.index ?? '# Control Index\n\n- Active work: `path:docs/control/CURRENT_HANDOFF.md`\n',
  );
  if (options?.includeSpecification !== false) {
    await writeFile(join(control, 'CONTINUITY_DESIGN.md'), '# Continuity Design\n');
  }
  await writeFile(
    join(control, 'regions', 'global.yaml'),
    `schema_version: 1
id: global
countries: []
languages: [en]
currencies: []
preferred_channels: [email, phone]
phone_regions: []
directories: [google-business-profile]
review_platforms: [google]
outreach_policy:
  default_autonomy: shadow
  require_operator_approval: true
  policy_review_required: true
seo:
  location_depth: country-and-locality
`,
  );
  return root;
}

describe('control schemas', () => {
  test('accepts the canonical environment shape', () => {
    expect(EnvironmentFileSchema.parse(validEnvironment).schema_version).toBe(1);
  });

  test('rejects invented work statuses', () => {
    expect(() =>
      WorkQueueSchema.parse({ schema_version: 1, items: [{ status: 'invented' }] }),
    ).toThrow();
  });

  test('rejects secret-bearing environment values', () => {
    const secretBearingEnvironment = {
      ...validEnvironment,
      environments: {
        production: {
          ...validEnvironment.environments.production,
          DATABASE_URL: 'postgres://user:pass@example/db',
        },
      },
    };

    expect(() => EnvironmentFileSchema.parse(secretBearingEnvironment)).toThrow(/secret value/i);
  });

  test('rejects nested secret keys and values recursively', () => {
    expect(() =>
      EnvironmentFileSchema.parse({
        ...validEnvironment,
        environments: {
          production: {
            ...validEnvironment.environments.production,
            railway: {
              ...validEnvironment.environments.production.railway,
              api: {
                ...validEnvironment.environments.production.railway.api,
                nested: { private_key: 'not-even-a-real-key' },
              },
            },
          },
        },
      }),
    ).toThrow(/secret key/i);

    expect(() =>
      EnvironmentFileSchema.parse({
        ...validEnvironment,
        environments: {
          production: {
            ...validEnvironment.environments.production,
            railway: {
              ...validEnvironment.environments.production.railway,
              api: {
                ...validEnvironment.environments.production.railway.api,
                nested: { harmless: ['safe', { deeper: 'sk-examplevalue' }] },
              },
            },
          },
        },
      }),
    ).toThrow(/secret value/i);
  });

  test('allows only the literal secret-metadata key allowlist', () => {
    expect(() =>
      EnvironmentFileSchema.parse({
        ...validEnvironment,
        environments: {
          production: {
            ...validEnvironment.environments.production,
            expected_secret_names: ['SUPABASE_SERVICE_ROLE_KEY'],
          },
        },
      }),
    ).not.toThrow();

    expect(() =>
      EnvironmentFileSchema.parse({
        ...validEnvironment,
        environments: {
          production: {
            ...validEnvironment.environments.production,
            expected_secret_names_extra: ['SUPABASE_SERVICE_ROLE_KEY'],
          },
        },
      }),
    ).toThrow(/secret key/i);
  });

  test('exports only the specified enum values', () => {
    expect(WorkStatusSchema.options).toEqual([
      'queued',
      'ready',
      'in_progress',
      'blocked',
      'review',
      'done',
    ]);
    expect(DriftSeveritySchema.options).toEqual(['info', 'warning', 'blocking']);
    expect(CapabilityStageSchema.options).toEqual([
      'observed',
      'catalogued',
      'candidate',
      'experiment',
      'validated',
      'production',
      'core',
      'deferred',
      'integration-only',
      'rejected',
      'superseded',
      'retired',
    ]);
  });
});

describe('control file loading and static verification', () => {
  test('loads and parses the canonical control files', async () => {
    const root = await makeControlRoot();

    const files = await loadControlFiles(root);

    expect(files.environments.schema_version).toBe(1);
    expect(files.workQueue.items[0]?.id).toBe('P2A-CONTROL-001');
    expect(files.currentHandoff).toContain('P2A-CONTROL-001');
  });

  test('loads representative YAML rather than only JSON-compatible fixtures', async () => {
    const root = await makeControlRoot();
    await writeFile(
      join(root, 'docs', 'control', 'ENVIRONMENTS.yaml'),
      `schema_version: 1
environments:
  production:
    github:
      repository: example/atlas
      branch: main
    supabase:
      project_ref: public-project-ref
      expected_migration: 0001_init
      required_tables:
        - spaces
    railway:
      api:
        public_url: https://api.example.test
        health_path: /healthz
      os:
        public_url: https://os.example.test
        health_path: /build-info.json
    required_variable_names:
      - DATABASE_URL
`,
    );

    await expect(loadControlFiles(root)).resolves.toMatchObject({
      environments: { schema_version: 1 },
    });
  });

  test('returns no findings for a coherent control set', async () => {
    const root = await makeControlRoot();

    await expect(verifyStatic(root)).resolves.toEqual([]);
  });

  test('blocks static verification when a regional pack is invalid', async () => {
    const root = await makeControlRoot();
    await writeFile(
      join(root, 'docs', 'control', 'regions', 'bad-child.yaml'),
      `schema_version: 1
id: bad-child
inherits: missing-parent
`,
    );

    await expect(verifyStatic(root)).resolves.toContainEqual(
      expect.objectContaining({
        code: 'control.region_packs_invalid',
        path: join('docs', 'control', 'regions'),
        severity: 'blocking',
      }),
    );
  });

  test('blocks static verification when research control files are invalid', async () => {
    const root = await makeControlRoot();
    await writeFile(
      join(root, 'docs', 'control', 'RESEARCH_LEDGER.yaml'),
      `schema_version: 1
sources: []
evidence: []
`,
    );
    await writeFile(
      join(root, 'docs', 'control', 'CAPABILITY_CANDIDATES.yaml'),
      `schema_version: 1
candidates: []
`,
    );

    await expect(verifyStatic(root)).resolves.toContainEqual(
      expect.objectContaining({
        code: 'control.research_invalid',
        path: join('docs', 'control', 'RESEARCH_LEDGER.yaml'),
        severity: 'blocking',
      }),
    );
  });

  test('does not mistake a natural handoff task ID for an API key prefix', async () => {
    const root = await makeControlRoot({
      handoff:
        '# Current Handoff\n\n**Handoff ID:** `atlas-continuity-task-5`\n\n- Work item: `P2A-CONTROL-001`\n',
    });

    await expect(verifyStatic(root)).resolves.toEqual([]);
  });

  test('reports when the handoff omits the single active work item', async () => {
    const root = await makeControlRoot({
      handoff: '# Current Handoff\n\nNo matching work item here.\n',
    });

    await expect(verifyStatic(root)).resolves.toEqual([
      expect.objectContaining({ code: 'control.handoff_active_work', severity: 'blocking' }),
    ]);
  });

  test('requires an exact structured Work item field match', async () => {
    const root = await makeControlRoot({
      handoff:
        '# Current Handoff\n\n- Work item: `P2A-CONTROL-0010`\n\nHistorical note: P2A-CONTROL-001\n',
    });

    await expect(verifyStatic(root)).resolves.toEqual([
      expect.objectContaining({ code: 'control.handoff_active_work', severity: 'blocking' }),
    ]);
  });

  test('rejects an active queue action that repeats a completed task instead of the handoff sequence', async () => {
    const root = await makeControlRoot({
      queue: {
        ...validQueue,
        items: [
          {
            ...validQueue.items[0],
            next_action: 'Implement Task 1 using tests first',
          },
        ],
      },
      handoff: `# Current Handoff

- Work item: \`P2A-CONTROL-001\`

## Next exact action

Independently review Task 1; after approval, implement Task 2 using tests first.
`,
    });

    await expect(verifyStatic(root)).resolves.toContainEqual(
      expect.objectContaining({
        code: 'control.handoff_next_action',
        severity: 'blocking',
      }),
    );
  });

  test('accepts the same review and execution task sequence in the queue and handoff', async () => {
    const root = await makeControlRoot({
      queue: {
        ...validQueue,
        items: [
          {
            ...validQueue.items[0],
            next_action:
              'Independently review Task 1; after approval, execute Task 2 using tests first',
          },
        ],
      },
      handoff: `# Current Handoff

- Work item: \`P2A-CONTROL-001\`

## Next exact action

Independently review Task 1; after approval, implement Task 2 using tests first.

## Definition of done

The review passes.
`,
    });

    await expect(verifyStatic(root)).resolves.toEqual([]);
  });

  test('checks repo-root-relative index paths regardless of extension', async () => {
    const root = await makeControlRoot({
      index:
        '# Control Index\n\n- Registry: `path:packages/registry/registry.ts`\n- Manifest: `path:packages/registry/MANIFEST`\n',
    });

    const findings = await verifyStatic(root);

    expect(findings).toEqual([
      expect.objectContaining({
        code: 'control.index_path_missing',
        path: join('packages', 'registry', 'MANIFEST'),
      }),
      expect.objectContaining({
        code: 'control.index_path_missing',
        path: join('packages', 'registry', 'registry.ts'),
      }),
    ]);
  });

  test('rejects absolute and outside-repository index paths', async () => {
    const root = await makeControlRoot({
      index:
        '# Control Index\n\n- Absolute: `path:/tmp/outside`\n- Traversal: `path:../outside.md`\n',
    });

    const findings = await verifyStatic(root);

    expect(findings.filter((finding) => finding.code === 'control.index_path_unsafe')).toHaveLength(2);
  });

  test('validates marked root-level extensionless and space-containing paths', async () => {
    const root = await makeControlRoot({
      index:
        '# Control Index\n\n- Container: `path:Dockerfile`\n- License: `path:LICENSE`\n- Playbook: `path:docs/control/My Playbook`\n',
    });
    await writeFile(join(root, 'LICENSE'), 'exists\n');

    const findings = await verifyStatic(root);

    expect(findings).toEqual([
      expect.objectContaining({ code: 'control.index_path_missing', path: 'Dockerfile' }),
      expect.objectContaining({
        code: 'control.index_path_missing',
        path: join('docs', 'control', 'My Playbook'),
      }),
    ]);
  });

  test('does not interpret non-path code spans as repository paths', async () => {
    const root = await makeControlRoot({
      index:
        '# Control Index\n\n- Verify: `pnpm control:verify`\n- Active ID: `P2A-CONTROL-001`\n',
    });

    await expect(verifyStatic(root)).resolves.toEqual([]);
  });

  test.each([
    ['../../package.json', ['package.json']],
    ['../outside.md', ['docs', 'outside.md']],
  ])(
    'rejects specification path %s when its outside target exists',
    async (specification, targetParts) => {
      const root = await makeControlRoot({
        queue: {
          ...validQueue,
          items: [{ ...validQueue.items[0], specification }],
        },
      });
      await writeFile(join(root, ...targetParts), 'existing outside target\n');

      await expect(verifyStatic(root)).resolves.toContainEqual(
        expect.objectContaining({
          code: 'control.specification_path_unsafe',
          path: `docs/control/${specification}`,
        }),
      );
    },
  );

  test('CLI runner prints blocking findings and returns exit status 1', async () => {
    const root = await makeControlRoot({
      handoff: '# Current Handoff\n\n- Work item: `WRONG-ID`\n',
    });
    const lines: string[] = [];

    const exitStatus = await runStaticVerificationCli(root, (line) => lines.push(line));

    expect(exitStatus).toBe(1);
    expect(lines).toEqual([
      'BLOCKING control.handoff_active_work docs/control/CURRENT_HANDOFF.md: handoff does not mention active work item P2A-CONTROL-001',
    ]);
  });

  test('reports all required coherence failures in severity order', async () => {
    const queue = {
      ...validQueue,
      items: [
        validQueue.items[0],
        {
          ...validQueue.items[0],
          id: 'P2A-CONTROL-002',
          specification: 'MISSING_SPEC.md',
        },
      ],
    };
    const root = await makeControlRoot({
      queue,
      handoff: '# Current Handoff\n\nNo matching work item here.\n',
      index: '# Control Index\n\n- Missing: `path:MISSING_INDEX.md`\n',
      includeSpecification: true,
    });
    await writeFile(
      join(root, 'docs', 'control', 'notes.md'),
      'DATABASE_URL=postgres://user:pass@example/db\n',
    );

    const findings = await verifyStatic(root);

    expect(findings.map((finding) => finding.code)).toEqual([
      'control.active_work_count',
      'control.index_path_missing',
      'control.secret_value',
      'control.specification_missing',
    ]);
    expect(findings.every((finding) => finding.severity === 'blocking')).toBe(true);
  });
});
