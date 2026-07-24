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
import { verifyStatic } from './verify-static.js';

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
  await writeFile(join(control, 'ENVIRONMENTS.yaml'), JSON.stringify(options?.environment ?? validEnvironment));
  await writeFile(join(control, 'WORK_QUEUE.yaml'), JSON.stringify(options?.queue ?? validQueue));
  await writeFile(
    join(control, 'CURRENT_HANDOFF.md'),
    options?.handoff ?? '# Current Handoff\n\nActive work item: `P2A-CONTROL-001`\n',
  );
  await writeFile(
    join(control, 'CONTROL_INDEX.md'),
    options?.index ?? '# Control Index\n\n- Active work: `CURRENT_HANDOFF.md`\n',
  );
  if (options?.includeSpecification !== false) {
    await writeFile(join(control, 'CONTINUITY_DESIGN.md'), '# Continuity Design\n');
  }
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

  test('returns no findings for a coherent control set', async () => {
    const root = await makeControlRoot();

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
      index: '# Control Index\n\n- Missing: `MISSING_INDEX.md`\n',
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
