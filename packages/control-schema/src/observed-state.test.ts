import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  collectObservedState,
  type CollectorFetch,
  type CollectorRun,
} from './collect-observed-state.js';
import { detectDrift, renderDriftReport, type DesiredState } from './drift.js';
import { writeObservedState } from './observed-state.js';

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

function injectedRun(headSha = githubSha): CollectorRun {
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
        stdout: JSON.stringify([{ databaseId: 101, conclusion: 'success', headSha }]),
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
}): CollectorFetch {
  return async (input, init) => {
    const url = String(input);
    if (url.endsWith('/healthz')) {
      return jsonResponse(200, {
        ok: true,
        service: 'atlas-api',
        appVersion: '0.1.0',
        gitSha: options.healthSha ?? 'unknown',
        buildTime: collectedAt,
        schemaVersion: '0001_init',
        registryVersion: 1,
      });
    }
    if (url.endsWith('/v1/status/mission_control')) {
      return jsonResponse(options.missionControlStatus ?? 200, { ok: true, cards: [] });
    }
    if (url.endsWith('/v1/memory/ingest')) {
      expect(init?.method).toBe('POST');
      expect(init?.body).toBe('{}');
      return jsonResponse(options.ingestStatus, { error: 'probe response' });
    }
    if (url.endsWith('/build-info.json')) {
      return jsonResponse(200, {
        service: 'atlas-os',
        appVersion: '0.1.0',
        gitSha: options.healthSha ?? 'unknown',
        buildTime: collectedAt,
        schemaVersion: '0001_init',
        registryVersion: 1,
      });
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
    const secret = ['postgresql:', '//admin:do-not-record@example.test/database'].join('');
    const observed = await collectObservedState({
      root,
      collectedAt,
      environment,
      run: async () => {
        throw new Error(`CLI unavailable while using ${secret}`);
      },
      fetch: async () => {
        throw new Error(`network unavailable near ${secret}`);
      },
      queryTables: async () => {
        throw new Error(`database unavailable at ${secret}`);
      },
      databaseUrl: secret,
    });

    expect(observed.localGit.status).toBe('unknown');
    expect(observed.github.status).toBe('unknown');
    expect(observed.supabase.status).toBe('unknown');
    expect(observed.railwayApi.status).toBe('unknown');
    expect(observed.railwayOs.status).toBe('unknown');
    expect(JSON.stringify(observed)).not.toContain(secret);
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
