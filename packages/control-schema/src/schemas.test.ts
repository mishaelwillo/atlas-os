import { execFileSync } from 'node:child_process';
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
import {
  runStaticVerificationCli as runStaticVerificationCliImplementation,
  verifyStatic as verifyStaticImplementation,
} from './verify-static.js';
import * as verifyStaticModule from './verify-static.js';

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
      hosting: {
        provider: 'cloudflare-pages',
        account_id: '0'.repeat(32),
        pages_project: 'atlas-sites',
        provider_url: 'https://atlas-sites.pages.dev',
        public_base_url: 'https://sites.example.test',
        zone: 'example.test',
        layout: 'path',
        required_variable_names: ['CLOUDFLARE_API_TOKEN'],
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
      specification: 'docs/control/CONTINUITY_DESIGN.md',
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
  authority?: 'valid' | 'raw';
}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'atlas-control-'));
  temporaryRoots.push(root);
  const control = join(root, 'docs', 'control');
  await mkdir(control, { recursive: true });
  await mkdir(join(control, 'regions'), { recursive: true });
  await writeFile(join(control, 'ENVIRONMENTS.yaml'), JSON.stringify(options?.environment ?? validEnvironment));
  await writeFile(join(control, 'WORK_QUEUE.yaml'), JSON.stringify(options?.queue ?? validQueue));
  let handoff =
    options?.handoff ?? '# Current Handoff\n\n- Work item: `P2A-CONTROL-001`\n';
  if (options?.authority !== 'raw') {
    if (!/^\s*-\s*Branch:/im.test(handoff)) {
      handoff += '- Branch: `codex/test`\n';
    }
    if (!/^\s*-\s*Head commit:/im.test(handoff)) {
      handoff += '- Head commit: `1111111111111111111111111111111111111111`\n';
    }
  }
  await writeFile(join(control, 'CURRENT_HANDOFF.md'), handoff);
  await writeFile(join(control, 'CURRENT_STATE.md'), '# Current State\n');
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

type InjectedGitObservation = {
  branch: string;
  headSha: string;
  boundaryExists: boolean;
  boundaryIsAncestor: boolean;
  changedPaths: string[];
  errors?: string[];
};

type InjectedGitHubContext =
  | {
      eventName: 'pull_request';
      headRef: string;
      headSha: string;
      baseRef: string;
    }
  | {
      eventName: 'push';
      ref: string;
      headSha: string;
    };

const coherentGit: InjectedGitObservation = {
  branch: 'codex/test',
  headSha: '2222222222222222222222222222222222222222',
  boundaryExists: true,
  boundaryIsAncestor: true,
  changedPaths: [],
};

const isolatedGitHubContext = async () => undefined;

function verifyStatic(root: string) {
  return verifyStaticImplementation(root, {
    observeGit: async () => coherentGit,
    observeGitHubContext: isolatedGitHubContext,
  });
}

function runStaticVerificationCli(
  root: string,
  writeLine: (line: string) => void,
) {
  const runner = runStaticVerificationCliImplementation as unknown as (
    repositoryRoot: string,
    output: (line: string) => void,
    options: {
      observeGit: () => Promise<InjectedGitObservation>;
      observeGitHubContext: () => Promise<undefined>;
    },
  ) => ReturnType<typeof runStaticVerificationCliImplementation>;
  return runner(root, writeLine, {
    observeGit: async () => coherentGit,
    observeGitHubContext: isolatedGitHubContext,
  });
}

async function verifyWithGit(
  root: string,
  git: InjectedGitObservation,
) {
  return verifyStaticImplementation(root, {
    observeGit: async () => git,
    observeGitHubContext: isolatedGitHubContext,
  });
}

async function verifyWithGitHubContext(
  root: string,
  git: InjectedGitObservation,
  githubContext: InjectedGitHubContext,
  observedTargets?: string[],
) {
  const runner = verifyStaticImplementation as unknown as (
    repositoryRoot: string,
    options: {
      observeGit: (
        root: string,
        boundaryCommit: string,
        targetCommit?: string,
      ) => Promise<InjectedGitObservation>;
      observeGitHubContext: () => Promise<InjectedGitHubContext>;
    },
  ) => ReturnType<typeof verifyStaticImplementation>;
  return runner(root, {
    observeGit: async (_root, _boundaryCommit, targetCommit) => {
      if (targetCommit) observedTargets?.push(targetCommit);
      return git;
    },
    observeGitHubContext: async () => githubContext,
  });
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

  test.each(['ghp_', 'gho_', 'ghu_', 'ghs_', 'ghr_', 'github_pat_'])(
    'rejects structured YAML containing a %s GitHub token without exposing it',
    (prefix) => {
      const token = `${prefix}abcdefghijklmnopqrstuvwxyz123456`;
      let message = '';
      try {
        EnvironmentFileSchema.parse({
          ...validEnvironment,
          environments: {
            production: {
              ...validEnvironment.environments.production,
              railway: {
                ...validEnvironment.environments.production.railway,
                api: {
                  ...validEnvironment.environments.production.railway.api,
                  harmless: token,
                },
              },
            },
          },
        });
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(message).toMatch(/prohibited secret value/i);
      expect(message).not.toContain(token);

      let keyMessage = '';
      try {
        EnvironmentFileSchema.parse({
          ...validEnvironment,
          [token]: 'safe',
        });
      } catch (error) {
        keyMessage = error instanceof Error ? error.message : String(error);
      }
      expect(keyMessage).toMatch(/prohibited secret key/i);
      expect(keyMessage).not.toContain(token);
    },
  );

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
  test.each([
    [
      'pull_request',
      {
        pull_request: {
          head: { ref: 'codex/test', sha: '3333333333333333333333333333333333333333' },
          base: { ref: 'main' },
        },
      },
      {
        eventName: 'pull_request',
        headRef: 'codex/test',
        headSha: '3333333333333333333333333333333333333333',
        baseRef: 'main',
      },
    ],
    [
      'push',
      {
        ref: 'refs/heads/main',
        after: '4444444444444444444444444444444444444444',
      },
      {
        eventName: 'push',
        ref: 'refs/heads/main',
        headSha: '4444444444444444444444444444444444444444',
      },
    ],
  ] as const)(
    'parses exact trusted GitHub %s event context without network access',
    async (eventName, event, expected) => {
      const readTrustedGitHubContext = (
        verifyStaticModule as unknown as {
          readTrustedGitHubContext: (
            environment: Record<string, string | undefined>,
            readEventFile: (path: string) => Promise<string>,
          ) => Promise<InjectedGitHubContext | undefined>;
        }
      ).readTrustedGitHubContext;

      expect(typeof readTrustedGitHubContext).toBe('function');
      await expect(
        readTrustedGitHubContext(
          {
            GITHUB_ACTIONS: 'true',
            GITHUB_EVENT_NAME: eventName,
            GITHUB_EVENT_PATH: 'injected-event.json',
          },
          async () => JSON.stringify(event),
        ),
      ).resolves.toEqual(expected);
    },
  );

  test('does not trust GitHub event-shaped input outside GitHub Actions', async () => {
    const readTrustedGitHubContext = (
      verifyStaticModule as unknown as {
        readTrustedGitHubContext: (
          environment: Record<string, string | undefined>,
          readEventFile: (path: string) => Promise<string>,
        ) => Promise<InjectedGitHubContext | undefined>;
      }
    ).readTrustedGitHubContext;

    expect(typeof readTrustedGitHubContext).toBe('function');
    await expect(
      readTrustedGitHubContext(
        {
          GITHUB_ACTIONS: 'false',
          GITHUB_EVENT_NAME: 'pull_request',
          GITHUB_EVENT_PATH: 'injected-event.json',
        },
        async () =>
          JSON.stringify({
            pull_request: {
              head: { ref: 'codex/test', sha: '3333333333333333333333333333333333333333' },
              base: { ref: 'main' },
            },
          }),
      ),
    ).resolves.toBeUndefined();
  });

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
    hosting:
      provider: cloudflare-pages
      account_id: '00000000000000000000000000000000'
      pages_project: atlas-sites
      provider_url: https://atlas-sites.pages.dev
      public_base_url: https://sites.example.test
      zone: example.test
      layout: path
      required_variable_names:
        - CLOUDFLARE_API_TOKEN
    required_variable_names:
      - DATABASE_URL
`,
    );

    await expect(loadControlFiles(root)).resolves.toMatchObject({
      environments: { schema_version: 1 },
    });
  });

  test('returns no findings for a coherent control set', async () => {
    const root = await makeControlRoot({
      handoff:
        '# Current Handoff\n\n- Work item: `P2A-CONTROL-001`\n- Branch: `codex/test`\n- Head commit: `1111111111111111111111111111111111111111`\n',
    });

    await expect(
      verifyWithGit(root, {
        branch: 'codex/test',
        headSha: '2222222222222222222222222222222222222222',
        boundaryExists: true,
        boundaryIsAncestor: true,
        changedPaths: ['docs/control/CURRENT_HANDOFF.md', 'docs/control/CURRENT_STATE.md'],
      }),
    ).resolves.toEqual([]);
  });

  test('isolates temporary control fixtures from ambient GitHub Actions context', async () => {
    const root = await makeControlRoot();
    const eventPath = join(root, 'github-event.json');
    await writeFile(
      eventPath,
      JSON.stringify({
        pull_request: {
          head: {
            ref: 'codex/atlas-continuity',
            sha: '3333333333333333333333333333333333333333',
          },
          base: { ref: 'main' },
        },
      }),
    );
    const previousEnvironment = {
      GITHUB_ACTIONS: process.env.GITHUB_ACTIONS,
      GITHUB_EVENT_NAME: process.env.GITHUB_EVENT_NAME,
      GITHUB_EVENT_PATH: process.env.GITHUB_EVENT_PATH,
    };
    process.env.GITHUB_ACTIONS = 'true';
    process.env.GITHUB_EVENT_NAME = 'pull_request';
    process.env.GITHUB_EVENT_PATH = eventPath;

    try {
      await expect(verifyStatic(root)).resolves.toEqual([]);
    } finally {
      for (const [name, value] of Object.entries(previousEnvironment)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });

  test('keeps local feature verification strict when the checked-out branch equals the recorded branch', async () => {
    const root = await makeControlRoot();

    await expect(verifyWithGit(root, coherentGit)).resolves.toEqual([]);
  });

  test('fails closed for an untrusted detached local checkout', async () => {
    const root = await makeControlRoot();

    await expect(
      verifyWithGit(root, {
        ...coherentGit,
        branch: '',
        errors: ['git branch --show-current failed: no branch returned'],
      }),
    ).resolves.toContainEqual(
      expect.objectContaining({
        severity: 'blocking',
        code: 'control.handoff_git_unavailable',
      }),
    );
  });

  test('uses trusted pull-request head context instead of a detached synthetic merge SHA', async () => {
    const root = await makeControlRoot();
    const prHead = '3333333333333333333333333333333333333333';
    const observedTargets: string[] = [];

    await expect(
      verifyWithGitHubContext(
        root,
        {
          branch: '',
          headSha: prHead,
          boundaryExists: true,
          boundaryIsAncestor: true,
          changedPaths: ['docs/control/CURRENT_HANDOFF.md'],
        },
        {
          eventName: 'pull_request',
          headRef: 'codex/test',
          headSha: prHead,
          baseRef: 'main',
        },
        observedTargets,
      ),
    ).resolves.toEqual([]);
    expect(observedTargets).toEqual([prHead]);
  });

  test('permits a trusted post-merge transition onto the authoritative integration branch', async () => {
    const root = await makeControlRoot();
    const integrationHead = '4444444444444444444444444444444444444444';
    const observedTargets: string[] = [];

    await expect(
      verifyWithGitHubContext(
        root,
        {
          branch: 'main',
          headSha: integrationHead,
          boundaryExists: true,
          boundaryIsAncestor: true,
          changedPaths: [
            'docs/control/CURRENT_HANDOFF.md',
            'docs/control/CURRENT_STATE.md',
          ],
        },
        {
          eventName: 'push',
          ref: 'refs/heads/main',
          headSha: integrationHead,
        },
        observedTargets,
      ),
    ).resolves.toEqual([]);
    expect(observedTargets).toEqual([integrationHead]);
  });

  test.each([
    [
      'pull-request head ref mismatch',
      {
        eventName: 'pull_request',
        headRef: 'codex/other',
        headSha: '3333333333333333333333333333333333333333',
        baseRef: 'main',
      },
      {
        branch: '',
        headSha: '3333333333333333333333333333333333333333',
        boundaryExists: true,
        boundaryIsAncestor: true,
        changedPaths: [],
      },
      'control.handoff_branch_mismatch',
    ],
    [
      'pull-request observed head SHA mismatch',
      {
        eventName: 'pull_request',
        headRef: 'codex/test',
        headSha: '3333333333333333333333333333333333333333',
        baseRef: 'main',
      },
      {
        branch: '',
        headSha: '5555555555555555555555555555555555555555',
        boundaryExists: true,
        boundaryIsAncestor: true,
        changedPaths: [],
      },
      'control.handoff_ci_head_mismatch',
    ],
    [
      'wrong pull-request base branch',
      {
        eventName: 'pull_request',
        headRef: 'codex/test',
        headSha: '3333333333333333333333333333333333333333',
        baseRef: 'develop',
      },
      {
        branch: '',
        headSha: '3333333333333333333333333333333333333333',
        boundaryExists: true,
        boundaryIsAncestor: true,
        changedPaths: [],
      },
      'control.handoff_integration_branch_mismatch',
    ],
    [
      'wrong push integration branch',
      {
        eventName: 'push',
        ref: 'refs/heads/develop',
        headSha: '4444444444444444444444444444444444444444',
      },
      {
        branch: 'develop',
        headSha: '4444444444444444444444444444444444444444',
        boundaryExists: true,
        boundaryIsAncestor: true,
        changedPaths: [],
      },
      'control.handoff_integration_branch_mismatch',
    ],
    [
      'non-ancestor PR boundary',
      {
        eventName: 'pull_request',
        headRef: 'codex/test',
        headSha: '3333333333333333333333333333333333333333',
        baseRef: 'main',
      },
      {
        branch: '',
        headSha: '3333333333333333333333333333333333333333',
        boundaryExists: true,
        boundaryIsAncestor: false,
        changedPaths: [],
      },
      'control.handoff_commit_not_ancestor',
    ],
    [
      'post-boundary production change after integration',
      {
        eventName: 'push',
        ref: 'refs/heads/main',
        headSha: '4444444444444444444444444444444444444444',
      },
      {
        branch: 'main',
        headSha: '4444444444444444444444444444444444444444',
        boundaryExists: true,
        boundaryIsAncestor: true,
        changedPaths: ['packages/control-schema/src/verify-static.ts'],
      },
      'control.handoff_boundary_changed',
    ],
  ] as const)(
    'blocks trusted CI takeover authority for %s',
    async (_name, context, git, code) => {
      const root = await makeControlRoot();

      await expect(
        verifyWithGitHubContext(root, git, context),
      ).resolves.toContainEqual(
        expect.objectContaining({ severity: 'blocking', code }),
      );
    },
  );

  test('reads the integration branch from repository control authority', async () => {
    const root = await makeControlRoot({
      environment: {
        ...validEnvironment,
        environments: {
          production: {
            ...validEnvironment.environments.production,
            github: { repository: 'example/atlas', branch: 'trunk' },
          },
        },
      },
    });
    const prHead = '3333333333333333333333333333333333333333';

    await expect(
      verifyWithGitHubContext(
        root,
        {
          branch: '',
          headSha: prHead,
          boundaryExists: true,
          boundaryIsAncestor: true,
          changedPaths: [],
        },
        {
          eventName: 'pull_request',
          headRef: 'codex/test',
          headSha: prHead,
          baseRef: 'trunk',
        },
      ),
    ).resolves.toEqual([]);
  });

  test.each([
    [
      'branch mismatch',
      {
        branch: 'codex/other',
        headSha: '2222222222222222222222222222222222222222',
        boundaryExists: true,
        boundaryIsAncestor: true,
        changedPaths: [],
      },
      'control.handoff_branch_mismatch',
    ],
    [
      'missing boundary commit',
      {
        branch: 'codex/test',
        headSha: '2222222222222222222222222222222222222222',
        boundaryExists: false,
        boundaryIsAncestor: false,
        changedPaths: [],
      },
      'control.handoff_commit_missing',
    ],
    [
      'non-ancestor boundary commit',
      {
        branch: 'codex/test',
        headSha: '2222222222222222222222222222222222222222',
        boundaryExists: true,
        boundaryIsAncestor: false,
        changedPaths: [],
      },
      'control.handoff_commit_not_ancestor',
    ],
    [
      'post-boundary production change',
      {
        branch: 'codex/test',
        headSha: '2222222222222222222222222222222222222222',
        boundaryExists: true,
        boundaryIsAncestor: true,
        changedPaths: ['packages/control-schema/src/verify-static.ts'],
      },
      'control.handoff_boundary_changed',
    ],
  ])('rejects Git takeover authority for %s', async (_name, git, code) => {
    const root = await makeControlRoot({
      handoff:
        '# Current Handoff\n\n- Work item: `P2A-CONTROL-001`\n- Branch: `codex/test`\n- Head commit: `1111111111111111111111111111111111111111`\n',
    });

    await expect(verifyWithGit(root, git)).resolves.toContainEqual(
      expect.objectContaining({ severity: 'blocking', code }),
    );
  });

  test('permits archived handoff Markdown as post-boundary metadata', async () => {
    const root = await makeControlRoot({
      handoff:
        '# Current Handoff\n\n- Work item: `P2A-CONTROL-001`\n- Branch: `codex/test`\n- Head commit: `1111111111111111111111111111111111111111`\n',
    });

    await expect(
      verifyWithGit(root, {
        branch: 'codex/test',
        headSha: '2222222222222222222222222222222222222222',
        boundaryExists: true,
        boundaryIsAncestor: true,
        changedPaths: [
          'docs/control/CURRENT_HANDOFF.md',
          'docs/control/handoffs/archived/2026-07-26-example-handoff.md',
        ],
      }),
    ).resolves.not.toContainEqual(
      expect.objectContaining({ code: 'control.handoff_boundary_changed' }),
    );
  });

  test('still blocks non-Markdown post-boundary files under the archive directory', async () => {
    const root = await makeControlRoot({
      handoff:
        '# Current Handoff\n\n- Work item: `P2A-CONTROL-001`\n- Branch: `codex/test`\n- Head commit: `1111111111111111111111111111111111111111`\n',
    });

    await expect(
      verifyWithGit(root, {
        branch: 'codex/test',
        headSha: '2222222222222222222222222222222222222222',
        boundaryExists: true,
        boundaryIsAncestor: true,
        changedPaths: ['docs/control/handoffs/archived/evil.ts'],
      }),
    ).resolves.toContainEqual(
      expect.objectContaining({
        severity: 'blocking',
        code: 'control.handoff_boundary_changed',
      }),
    );
  });

  test.each([
    [
      'missing Branch',
      '# Current Handoff\n\n- Work item: `P2A-CONTROL-001`\n- Head commit: `1111111111111111111111111111111111111111`\n',
    ],
    [
      'missing Head commit',
      '# Current Handoff\n\n- Work item: `P2A-CONTROL-001`\n- Branch: `codex/test`\n',
    ],
    [
      'unparsable Branch',
      '# Current Handoff\n\n- Work item: `P2A-CONTROL-001`\n- Branch: `feature branch`\n- Head commit: `1111111111111111111111111111111111111111`\n',
    ],
    [
      'unparsable option-like Branch',
      '# Current Handoff\n\n- Work item: `P2A-CONTROL-001`\n- Branch: `-invalid`\n- Head commit: `1111111111111111111111111111111111111111`\n',
    ],
    [
      'unparsable Head commit',
      '# Current Handoff\n\n- Work item: `P2A-CONTROL-001`\n- Branch: `codex/test`\n- Head commit: `not-a-commit`\n',
    ],
  ])('fails closed for %s takeover metadata', async (_name, handoff) => {
    const root = await makeControlRoot({ handoff, authority: 'raw' });

    await expect(verifyStatic(root)).resolves.toContainEqual(
      expect.objectContaining({
        severity: 'blocking',
        code: 'control.handoff_authority_invalid',
      }),
    );
  });

  test.each(['branch', 'head', 'cat-file', 'merge-base', 'diff'])(
    'fails closed when the Git %s probe fails',
    async (probe) => {
      const root = await makeControlRoot();

      await expect(
        verifyWithGit(root, {
          ...coherentGit,
          errors: [`git ${probe} probe failed`],
        }),
      ).resolves.toContainEqual(
        expect.objectContaining({
          severity: 'blocking',
          code: 'control.handoff_git_unavailable',
        }),
      );
    },
  );

  test('reports a real absent boundary as missing instead of Git unavailable', async () => {
    const root = await makeControlRoot();
    execFileSync('git', ['init', '-b', 'codex/test'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'Atlas Test'], { cwd: root });
    execFileSync('git', ['config', 'user.email', 'atlas@example.test'], {
      cwd: root,
    });
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['commit', '-m', 'fixture'], { cwd: root });

    const findings = await verifyStaticImplementation(root);

    expect(findings).toContainEqual(
      expect.objectContaining({
        severity: 'blocking',
        code: 'control.handoff_commit_missing',
      }),
    );
    expect(findings).not.toContainEqual(
      expect.objectContaining({ code: 'control.handoff_git_unavailable' }),
    );
  });

  test.each(['ghp_', 'gho_', 'ghu_', 'ghs_', 'ghr_', 'github_pat_'])(
    'detects a %s GitHub token in Markdown control docs without exposing it',
    async (prefix) => {
      const root = await makeControlRoot();
      const token = `${prefix}abcdefghijklmnopqrstuvwxyz123456`;
      await writeFile(
        join(root, 'docs', 'control', 'CONTINUITY_DESIGN.md'),
        `# Continuity Design\n\nAccidental value: ${token}\n`,
      );

      const findings = await verifyStatic(root);

      expect(findings).toContainEqual(
        expect.objectContaining({
          severity: 'blocking',
          code: 'control.secret_value',
        }),
      );
      expect(JSON.stringify(findings)).not.toContain(token);
    },
  );

  test.each(['ghp_', 'gho_', 'ghu_', 'ghs_', 'ghr_', 'github_pat_'])(
    'detects a %s GitHub token in handoff content without exposing it',
    async (prefix) => {
      const token = `${prefix}abcdefghijklmnopqrstuvwxyz123456`;
      const root = await makeControlRoot({
        handoff:
          `# Current Handoff\n\nAccidental value: ${token}\n` +
          '- Work item: `P2A-CONTROL-001`\n' +
          '- Branch: `codex/test`\n' +
          '- Head commit: `1111111111111111111111111111111111111111`\n',
      });

      const findings = await verifyStatic(root);

      expect(findings).toContainEqual(
        expect.objectContaining({
          severity: 'blocking',
          code: 'control.secret_value',
        }),
      );
      expect(JSON.stringify(findings)).not.toContain(token);
    },
  );

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
          path: specification,
        }),
      );
    },
  );

  test('allows nested repository-relative specifications inside docs', async () => {
    const root = await makeControlRoot({
      queue: {
        ...validQueue,
        items: [
          {
            ...validQueue.items[0],
            id: 'P2A-MEMORY-001',
            specification: 'docs/specs/p2/intelligence-foundation.md',
          },
        ],
      },
      handoff:
        '# Current Handoff\n\n- Work item: `P2A-MEMORY-001`\n- Branch: `codex/test`\n- Head commit: `1111111111111111111111111111111111111111`\n',
    });
    await mkdir(join(root, 'docs', 'specs', 'p2'), { recursive: true });
    await writeFile(
      join(root, 'docs', 'specs', 'p2', 'intelligence-foundation.md'),
      '# Intelligence Foundation\n',
    );

    await expect(
      verifyWithGit(root, {
        branch: 'codex/test',
        headSha: '1111111111111111111111111111111111111111',
        boundaryExists: true,
        boundaryIsAncestor: true,
        changedPaths: [],
      }),
    ).resolves.toEqual([]);
  });

  test.each([
    '/tmp/specification.md',
    'C:\\outside\\specification.md',
    '../outside.md',
    'README.md',
  ])('rejects unsafe repository specification path %s', async (specification) => {
    const root = await makeControlRoot({
      queue: {
        ...validQueue,
        items: [{ ...validQueue.items[0], specification }],
      },
    });

    await expect(verifyStatic(root)).resolves.toContainEqual(
      expect.objectContaining({
        severity: 'blocking',
        code: 'control.specification_path_unsafe',
      }),
    );
  });

  test('rejects internal traversal segments even when normalization stays inside docs', async () => {
    const root = await makeControlRoot({
      queue: {
        ...validQueue,
        items: [
          {
            ...validQueue.items[0],
            specification: 'docs/specs/../control/CONTINUITY_DESIGN.md',
          },
        ],
      },
    });

    await expect(verifyStatic(root)).resolves.toContainEqual(
      expect.objectContaining({
        severity: 'blocking',
        code: 'control.specification_path_unsafe',
      }),
    );
  });

  test('rejects an active work item routed to another specification owner', async () => {
    const root = await makeControlRoot({
      queue: {
        ...validQueue,
        items: [
          {
            ...validQueue.items[0],
            id: 'P2A-MEMORY-001',
            specification: 'docs/control/CONTINUITY_DESIGN.md',
          },
        ],
      },
      handoff:
        '# Current Handoff\n\n- Work item: `P2A-MEMORY-001`\n- Branch: `codex/test`\n- Head commit: `1111111111111111111111111111111111111111`\n',
    });

    await expect(verifyStatic(root)).resolves.toContainEqual(
      expect.objectContaining({
        severity: 'blocking',
        code: 'control.specification_owner_mismatch',
      }),
    );
  });

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
          specification: 'docs/control/MISSING_SPEC.md',
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
