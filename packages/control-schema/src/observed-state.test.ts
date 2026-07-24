import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  collectObservedState,
  runStatusCli,
  type CollectorFetch,
  type CollectorRun,
} from './collect-observed-state.js';
import {
  detectDrift,
  renderDriftReport,
  sortDriftFindings,
  type DesiredState,
} from './drift.js';
import {
  redactSecrets,
  type ObservedState,
  writeObservedState,
} from './observed-state.js';

const collectedAt = '2026-07-24T12:00:00.000Z';
const githubSha = '6b70726b1e000000000000000000000000000000';

function desired(overrides: Partial<DesiredState> = {}): DesiredState {
  return {
    phase: 'P1 deployment closure',
    phaseComplete: false,
    acceptanceEvidence: [],
    requiredTables: ['memory_cards', 'memory_nodes'],
    handoffUpdatedAt: '2026-07-24T11:30:00.000Z',
    staticVerificationFindings: [],
    ...overrides,
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function injectedRun(
  headSha = githubSha,
  runs: unknown = [{ databaseId: 101, conclusion: 'success', headSha }],
): CollectorRun {
  return async (command, args) => {
    const key = `${command} ${args.join(' ')}`;
    if (key === 'git rev-parse --abbrev-ref HEAD') {
      return { stdout: 'codex/atlas-continuity\n', stderr: '', exitCode: 0 };
    }
    if (key === 'git rev-parse HEAD') {
      return { stdout: '780a752f5940e66bf78fd7649cb6fc04d66a8941\n', stderr: '', exitCode: 0 };
    }
    if (key.includes('gh api repos/mishaelwillo/atlas-os/commits/main')) {
      return {
        stdout: JSON.stringify({ sha: headSha }),
        stderr: '',
        exitCode: 0,
      };
    }
    if (key.includes('gh run list')) {
      return {
        stdout: JSON.stringify(runs),
        stderr: '',
        exitCode: 0,
      };
    }
    throw new Error(`unexpected command: ${key}`);
  };
}

function injectedFetch(options: {
  healthSha?: string;
  ingestStatus: number;
  missionControlStatus?: number;
  healthStatus?: number;
  healthBody?: unknown;
  missionControlBody?: unknown;
  osStatus?: number;
  osBody?: unknown;
}): CollectorFetch {
  return async (input, init) => {
    const url = String(input);
    if (url.endsWith('/healthz')) {
      return jsonResponse(
        options.healthStatus ?? 200,
        options.healthBody ?? {
          ok: true,
          service: 'atlas-api',
          appVersion: '0.1.0',
          gitSha: options.healthSha ?? 'unknown',
          buildTime: collectedAt,
          schemaVersion: '0001_init',
          registryVersion: 1,
        },
      );
    }
    if (url.endsWith('/v1/status/mission_control')) {
      return jsonResponse(
        options.missionControlStatus ?? 200,
        options.missionControlBody ?? { ok: true, cards: [] },
      );
    }
    if (url.endsWith('/v1/memory/ingest')) {
      expect(init?.method).toBe('POST');
      expect(init?.body).toBe('{}');
      return jsonResponse(options.ingestStatus, { error: 'probe response' });
    }
    if (url.endsWith('/build-info.json')) {
      return jsonResponse(
        options.osStatus ?? 200,
        options.osBody ?? {
          service: 'atlas-os',
          appVersion: '0.1.0',
          gitSha: options.healthSha ?? 'unknown',
          buildTime: collectedAt,
          schemaVersion: '0001_init',
          registryVersion: 1,
        },
      );
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
}

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'atlas-control-observed-'));
  await mkdir(join(root, 'apps', 'api', 'src'), { recursive: true });
  await mkdir(join(root, 'docs', 'control', 'generated'), { recursive: true });
  await writeFile(
    join(root, 'apps', 'api', 'src', 'routes.gen.ts'),
    `export const GENERATED_CAPABILITY_IDS = ["memory.answer", "memory.ingest"] as const;\n`,
    'utf8',
  );
  return root;
}

const environment = {
  github: { repository: 'mishaelwillo/atlas-os', branch: 'main' },
  supabase: {
    project_ref: 'example',
    expected_migration: '0001_init',
    required_tables: ['memory_cards', 'memory_nodes'],
  },
  railway: {
    api: {
      public_url: 'https://api.example.test',
      health_path: '/healthz',
    },
    os: {
      public_url: 'https://os.example.test',
      health_path: '/build-info.json',
    },
  },
  required_variable_names: ['DATABASE_URL'],
};

describe('observed-state collection and drift', () => {
  it('reports the P0-versus-P1 missing route as blocking', async () => {
    const root = await fixtureRoot();
    const observed = await collectObservedState({
      root,
      collectedAt,
      environment,
      run: injectedRun(),
      fetch: injectedFetch({ ingestStatus: 404, missionControlStatus: 200 }),
      queryTables: async () => ['memory_cards', 'memory_nodes'],
      databaseUrl: 'opaque-test-database-url',
    });

    expect(observed.railwayApi.value?.routes.missionControl.status).toBe(200);
    expect(observed.railwayApi.value?.routes.memoryIngest.status).toBe(404);
    expect(JSON.stringify(observed)).not.toContain('opaque-test-database-url');

    const findings = detectDrift(desired(), observed);
    expect(findings).toContainEqual(
      expect.objectContaining({
        severity: 'blocking',
        code: 'railway.api.route_missing',
      }),
    );
  });

  it('accepts an unauthenticated route response when API and GitHub fingerprints agree', async () => {
    const root = await fixtureRoot();
    const observed = await collectObservedState({
      root,
      collectedAt,
      environment,
      run: injectedRun(),
      fetch: injectedFetch({ healthSha: githubSha, ingestStatus: 401 }),
      queryTables: async () => ['memory_cards', 'memory_nodes'],
      databaseUrl: 'opaque-test-database-url',
    });

    const findings = detectDrift(desired(), observed);
    expect(findings.filter((finding) => finding.severity === 'blocking')).toEqual([]);
  });

  it('records unavailable authorities explicitly without throwing or leaking error secrets', async () => {
    const root = await fixtureRoot();
    const secrets = [
      ['gh', 'p_examplePersonalAccessToken123'].join(''),
      ['gh', 'o_exampleOauthToken123'].join(''),
      ['github_', 'pat_exampleFineGrainedToken123'].join(''),
      ['sb_', 'secret_exampleSupabaseToken123'].join(''),
      ['sk', '-exampleOpenAiToken123'].join(''),
      ['Bearer', ' exampleBearerToken123'].join(''),
      ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', 'signature123'].join('.'),
      ['postgresql:', '//admin:do-not-record@example.test/database'].join(''),
      ['PASSWORD', '="do-not-record-password"'].join(''),
      ['api_key', '=do-not-record-api-key'].join(''),
    ];
    const externalError = `probe context ${secrets.join(' ')}`;
    const observed = await collectObservedState({
      root,
      collectedAt,
      environment,
      run: async () => {
        throw new Error(`CLI unavailable: ${externalError}`);
      },
      fetch: async () => {
        throw new Error(`HTTP unavailable: ${externalError}`);
      },
      queryTables: async () => {
        throw new Error(`PG unavailable: ${externalError}`);
      },
      databaseUrl: secrets[7],
    });

    expect(observed.localGit.status).toBe('unknown');
    expect(observed.github.status).toBe('unknown');
    expect(observed.supabase.status).toBe('unknown');
    expect(observed.railwayApi.status).toBe('unknown');
    expect(observed.railwayOs.status).toBe('unknown');
    const serialized = JSON.stringify(observed);
    for (const secret of secrets) {
      expect(serialized).not.toContain(secret);
    }
    expect(serialized).toContain('probe context');
    expect(serialized).toContain('[redacted]');
  });

  it('redacts secret forms directly and again at the output boundary', async () => {
    const values = [
      ['gh', 'p_abcdefghijklmnopqrstuvwxyz123456'].join(''),
      ['gh', 'o_abcdefghijklmnopqrstuvwxyz123456'].join(''),
      ['github_', 'pat_abcdefghijklmnopqrstuvwxyz123456'].join(''),
      ['sb_', 'secret_abcdefghijklmnopqrstuvwxyz123456'].join(''),
      ['sk', '-abcdefghijklmnopqrstuvwxyz123456'].join(''),
      ['Bearer', ' abcdefghijklmnopqrstuvwxyz123456'].join(''),
      ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', 'signature123'].join('.'),
      ['postgres:', '//user:password@example.test/db'].join(''),
      ['password', "='quoted-value'"].join(''),
      ['SeCrEt', '=unquoted-value'].join(''),
      ['TOKEN', ': another-value'].join(''),
      ['api_key', '="api-value"'].join(''),
    ];
    const text = `Useful failure context ${values.join(' ')}`;
    const redacted = redactSecrets(text);
    expect(redacted).toContain('Useful failure context');
    expect(redacted).toContain('[redacted]');
    values.forEach((value) => expect(redacted).not.toContain(value));

    const root = await fixtureRoot();
    const observed = await collectObservedState({
      root,
      collectedAt,
      environment,
      run: injectedRun(),
      fetch: injectedFetch({ healthSha: githubSha, ingestStatus: 401 }),
      queryTables: async () => ['memory_cards', 'memory_nodes'],
      databaseUrl: 'opaque-test-database-url',
    });
    observed.localGit.error = text;
    await writeObservedState(root, observed, []);
    const output = await readFile(
      join(root, 'docs', 'control', 'generated', 'observed-state.json'),
      'utf8',
    );
    values.forEach((value) => expect(output).not.toContain(value));
    expect(output).toContain('Useful failure context');
  });

  it('does not query Supabase when DATABASE_URL is absent', async () => {
    const root = await fixtureRoot();
    let queried = false;
    const observed = await collectObservedState({
      root,
      collectedAt,
      environment,
      run: injectedRun(),
      fetch: injectedFetch({ healthSha: githubSha, ingestStatus: 403 }),
      queryTables: async () => {
        queried = true;
        return [];
      },
    });

    expect(queried).toBe(false);
    expect(observed.supabase).toMatchObject({
      status: 'unknown',
      evidence: 'DATABASE_URL is unavailable; live table state was not queried.',
    });
  });

  it('emits required blocking and freshness findings in deterministic order', async () => {
    const root = await fixtureRoot();
    const observed = await collectObservedState({
      root,
      collectedAt: '2026-07-24T09:00:00.000Z',
      environment,
      run: injectedRun(),
      fetch: injectedFetch({
        healthSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        ingestStatus: 401,
      }),
      queryTables: async () => ['memory_cards'],
      databaseUrl: 'opaque-test-database-url',
    });

    const findings = detectDrift(
      desired({
        phaseComplete: true,
        acceptanceEvidence: [],
        handoffUpdatedAt: '2026-07-23T00:00:00.000Z',
        staticVerificationFindings: [
          {
            severity: 'blocking',
            code: 'control.invalid',
            path: 'docs/control/example.yaml',
            message: 'invalid fixture',
          },
        ],
        now: collectedAt,
      }),
      observed,
    );

    expect(findings.map((finding) => finding.code)).toEqual([
      'control.static_verification_failed',
      'phase.acceptance_evidence_missing',
      'railway.api.sha_mismatch',
      'supabase.required_tables_missing',
      'control.handoff_stale',
      'control.observed_state_stale',
    ]);
  });

  it.each([
    ['health 500', { healthStatus: 500, ingestStatus: 401 }],
    ['mission-control 500', { missionControlStatus: 500, ingestStatus: 401 }],
    ['memory 405', { ingestStatus: 405 }],
    ['memory 429', { ingestStatus: 429 }],
    [
      'malformed health',
      { ingestStatus: 401, healthBody: { ok: true, service: 'atlas-api' } },
    ],
    [
      'malformed mission-control body',
      { ingestStatus: 401, missionControlBody: { ok: true } },
    ],
  ])('does not report the Railway API as ok for %s', async (_name, fetchOptions) => {
    const root = await fixtureRoot();
    const observed = await collectObservedState({
      root,
      collectedAt,
      environment,
      run: injectedRun(),
      fetch: injectedFetch({ healthSha: githubSha, ...fetchOptions }),
      queryTables: async () => ['memory_cards', 'memory_nodes'],
      databaseUrl: 'opaque-test-database-url',
    });

    expect(observed.railwayApi.status).not.toBe('ok');
    expect(detectDrift(desired(), observed)).toContainEqual(
      expect.objectContaining({
        severity: 'blocking',
        code: 'railway.api.probe_invalid',
      }),
    );
  });

  it('does not accept malformed JSON from API health', async () => {
    const root = await fixtureRoot();
    const baseline = injectedFetch({ healthSha: githubSha, ingestStatus: 401 });
    const observed = await collectObservedState({
      root,
      collectedAt,
      environment,
      run: injectedRun(),
      fetch: async (input, init) =>
        String(input).endsWith('/healthz')
          ? new Response('{not-json', {
              status: 200,
              headers: { 'content-type': 'application/json' },
            })
          : baseline(input, init),
      queryTables: async () => ['memory_cards', 'memory_nodes'],
      databaseUrl: 'opaque-test-database-url',
    });

    expect(observed.railwayApi.status).not.toBe('ok');
    expect(observed.railwayApi.error).toContain('health');
  });

  it.each([
    ['no runs', []],
    ['missing conclusion', [{ databaseId: 102, headSha: githubSha }]],
    ['empty conclusion', [{ databaseId: 103, conclusion: '', headSha: githubSha }]],
    [
      'in-progress conclusion',
      [{ databaseId: 104, conclusion: 'in_progress', headSha: githubSha }],
    ],
  ])('records GitHub CI as unknown for %s', async (_name, runs) => {
    const root = await fixtureRoot();
    const observed = await collectObservedState({
      root,
      collectedAt,
      environment,
      run: injectedRun(githubSha, runs),
      fetch: injectedFetch({ healthSha: githubSha, ingestStatus: 401 }),
      queryTables: async () => ['memory_cards', 'memory_nodes'],
      databaseUrl: 'opaque-test-database-url',
    });

    expect(observed.github.status).toBe('unknown');
    expect(observed.github.value?.headSha).toBe(githubSha);
    expect(observed.github.evidence).toContain('CI');
    expect(detectDrift(desired(), observed)).toContainEqual(
      expect.objectContaining({
        severity: 'warning',
        code: 'github.state_unknown',
      }),
    );
  });

  it('warns explicitly when collectedAt is invalid', async () => {
    const root = await fixtureRoot();
    const observed = await collectObservedState({
      root,
      collectedAt: 'not-an-iso-timestamp',
      environment,
      run: injectedRun(),
      fetch: injectedFetch({ healthSha: githubSha, ingestStatus: 401 }),
      queryTables: async () => ['memory_cards', 'memory_nodes'],
      databaseUrl: 'opaque-test-database-url',
    });

    expect(detectDrift(desired({ now: collectedAt }), observed)).toContainEqual(
      expect.objectContaining({
        severity: 'warning',
        code: 'control.observed_state_timestamp_invalid',
      }),
    );
  });

  it('sorts findings by locale-independent codepoint order', () => {
    const findings = sortDriftFindings([
      { severity: 'warning', code: 'ä.code', message: 'second' },
      { severity: 'warning', code: 'z.code', message: 'first' },
    ]);
    expect(findings.map((item) => item.code)).toEqual(['z.code', 'ä.code']);
  });

  it('ignores only the generated runtime evidence outputs while retaining .gitkeep', () => {
    const repositoryRoot = resolve(process.cwd(), '../..');
    for (const path of [
      'docs/control/generated/observed-state.json',
      'docs/control/generated/drift-report.md',
    ]) {
      expect(() =>
        execFileSync('git', ['check-ignore', '--no-index', '--quiet', path], {
          cwd: repositoryRoot,
        }),
      ).not.toThrow();
    }
    expect(() =>
      execFileSync(
        'git',
        ['check-ignore', '--no-index', '--quiet', 'docs/control/generated/.gitkeep'],
        { cwd: repositoryRoot },
      ),
    ).toThrow();
  });

  it.each([
    ['blocking', 404, 1],
    ['healthy', 401, 0],
  ])('status CLI writes reports and returns the expected code for %s drift', async (_name, ingestStatus, exitCode) => {
    const root = await fixtureRoot();
    const lines: string[] = [];
    const result = await runStatusCli({
      root,
      collectedAt,
      environment,
      desired: desired({ now: collectedAt }),
      run: injectedRun(),
      fetch: injectedFetch({ healthSha: githubSha, ingestStatus }),
      queryTables: async () => ['memory_cards', 'memory_nodes'],
      databaseUrl: 'opaque-test-database-url',
      writeLine: (line) => lines.push(line),
    });

    expect(result).toBe(exitCode);
    if (exitCode === 1) {
      expect(lines.some((line) => line.startsWith('BLOCKING '))).toBe(true);
    } else {
      expect(lines.some((line) => line.startsWith('BLOCKING '))).toBe(false);
    }
    expect(lines.at(-1)).toContain('observed-state.json');
    expect(
      await readFile(
        join(root, 'docs', 'control', 'generated', 'observed-state.json'),
        'utf8',
      ),
    ).toContain('"schemaVersion": 1');
  });

  it('writes stable JSON and Markdown with provenance and final newlines', async () => {
    const root = await fixtureRoot();
    const observed = await collectObservedState({
      root,
      collectedAt,
      environment,
      run: injectedRun(),
      fetch: injectedFetch({ ingestStatus: 404 }),
      queryTables: async () => ['memory_cards', 'memory_nodes'],
      databaseUrl: 'opaque-test-database-url',
    });
    const findings = detectDrift(desired({ now: collectedAt }), observed);

    await writeObservedState(root, observed, findings);
    const observedJson = await readFile(
      join(root, 'docs', 'control', 'generated', 'observed-state.json'),
      'utf8',
    );
    const report = await readFile(
      join(root, 'docs', 'control', 'generated', 'drift-report.md'),
      'utf8',
    );

    expect(observedJson.endsWith('\n')).toBe(true);
    expect(JSON.parse(observedJson).provenance.collector).toBe('@atlas/control-schema');
    expect(report).toBe(renderDriftReport(observed, findings));
    expect(report).toContain('# Atlas Drift Report');
    expect(report).toContain('## Blocking');
    expect(report).toContain('[railway.api.route_missing]');
    expect(report).toContain('## Evidence');
    expect(report.endsWith('\n')).toBe(true);
  });
});
