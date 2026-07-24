import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { loadControlFiles } from './load.js';
import { detectDrift, type DesiredState } from './drift.js';
import {
  type BuildFingerprint,
  type Observation,
  type ObservedState,
  writeObservedState,
} from './observed-state.js';
import { verifyStatic } from './verify-static.js';

const execFileAsync = promisify(execFile);
const TABLE_QUERY = `select table_name
from information_schema.tables
where table_schema = 'public'
order by table_name`;
const DEFAULT_TIMEOUT_MS = 15_000;
const SECRET_TEXT =
  /gho_[A-Za-z0-9_-]+|github_pat_[A-Za-z0-9_-]+|sb_secret_[A-Za-z0-9_-]+|sk-[A-Za-z0-9_-]+|postgres(?:ql)?:\/\/\S+/gi;

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type CollectorRun = (
  command: string,
  args: string[],
  options: { cwd: string; timeoutMs: number },
) => Promise<RunResult>;

export type CollectorFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export type QueryTables = (
  databaseUrl: string,
  sql: string,
  timeoutMs: number,
) => Promise<string[]>;

export interface CollectorEnvironment {
  github: { repository: string; branch: string };
  supabase: {
    project_ref: string;
    expected_migration: string;
    required_tables: string[];
  };
  railway: {
    api: { public_url: string; health_path: string };
    os: { public_url: string; health_path: string };
  };
  required_variable_names: string[];
}

export interface CollectObservedStateOptions {
  root: string;
  collectedAt?: string;
  environment: CollectorEnvironment;
  run?: CollectorRun;
  fetch?: CollectorFetch;
  queryTables?: QueryTables;
  databaseUrl?: string;
  timeoutMs?: number;
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(SECRET_TEXT, '[redacted]').slice(0, 500);
}

function safeUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

function ok<T>(checkedAt: string, value: T, evidence: string): Observation<T> {
  return { status: 'ok', checkedAt, value, evidence };
}

function unknown<T>(
  checkedAt: string,
  evidence: string,
  error?: unknown,
): Observation<T> {
  return {
    status: 'unknown',
    checkedAt,
    evidence,
    ...(error === undefined ? {} : { error: safeError(error) }),
  };
}

async function defaultRun(
  command: string,
  args: string[],
  options: { cwd: string; timeoutMs: number },
): Promise<RunResult> {
  try {
    const result = await execFileAsync(command, args, {
      cwd: options.cwd,
      timeout: options.timeoutMs,
      windowsHide: true,
      encoding: 'utf8',
    });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (error) {
    const result = error as Error & {
      stdout?: string;
      stderr?: string;
      code?: number | string;
    };
    return {
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? result.message,
      exitCode: typeof result.code === 'number' ? result.code : 1,
    };
  }
}

async function defaultFetch(input: string, init: RequestInit = {}): Promise<Response> {
  return fetch(input, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });
}

async function defaultQueryTables(
  databaseUrl: string,
  sql: string,
  timeoutMs: number,
): Promise<string[]> {
  if (sql !== TABLE_QUERY) {
    throw new Error('Only the approved read-only table inventory query is allowed.');
  }
  const { Client } = await import('pg');
  const client = new Client({
    connectionString: databaseUrl,
    connectionTimeoutMillis: timeoutMs,
    query_timeout: timeoutMs,
    statement_timeout: timeoutMs,
  });
  try {
    await client.connect();
    const result = await client.query<{ table_name: string }>(TABLE_QUERY);
    return result.rows.map((row) => row.table_name);
  } finally {
    await client.end().catch(() => undefined);
  }
}

function parseJson(text: string): unknown {
  return JSON.parse(text.trim());
}

function fingerprint(value: unknown): BuildFingerprint | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const source = value as Record<string, unknown>;
  return {
    ...(typeof source.service === 'string' ? { service: source.service } : {}),
    ...(typeof source.appVersion === 'string' ? { appVersion: source.appVersion } : {}),
    ...(typeof source.gitSha === 'string' ? { gitSha: source.gitSha } : {}),
    ...(typeof source.buildTime === 'string' ? { buildTime: source.buildTime } : {}),
    ...(typeof source.schemaVersion === 'string'
      ? { schemaVersion: source.schemaVersion }
      : {}),
    ...(typeof source.registryVersion === 'number'
      ? { registryVersion: source.registryVersion }
      : {}),
  };
}

async function collectLocalGit(
  run: CollectorRun,
  root: string,
  checkedAt: string,
  timeoutMs: number,
): Promise<ObservedState['localGit']> {
  try {
    const [branch, sha] = await Promise.all([
      run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root, timeoutMs }),
      run('git', ['rev-parse', 'HEAD'], { cwd: root, timeoutMs }),
    ]);
    if (branch.exitCode !== 0 || sha.exitCode !== 0) {
      return unknown(checkedAt, 'Local Git identity could not be read.');
    }
    const value = { branch: branch.stdout.trim(), sha: sha.stdout.trim() };
    return ok(checkedAt, value, `git ${value.branch} @ ${value.sha}`);
  } catch (error) {
    return unknown(checkedAt, 'Local Git CLI is unavailable.', error);
  }
}

async function collectGithub(
  run: CollectorRun,
  root: string,
  checkedAt: string,
  timeoutMs: number,
  environment: CollectorEnvironment,
): Promise<ObservedState['github']> {
  const { repository, branch } = environment.github;
  try {
    const [commit, workflow] = await Promise.all([
      run('gh', ['api', `repos/${repository}/commits/${branch}`], {
        cwd: root,
        timeoutMs,
      }),
      run(
        'gh',
        [
          'run',
          'list',
          '--repo',
          repository,
          '--branch',
          branch,
          '--limit',
          '1',
          '--json',
          'databaseId,conclusion,headSha',
        ],
        { cwd: root, timeoutMs },
      ),
    ]);
    if (commit.exitCode !== 0 || workflow.exitCode !== 0) {
      return unknown(checkedAt, 'GitHub CLI did not return head and CI evidence.');
    }
    const commitJson = parseJson(commit.stdout) as { sha?: unknown };
    const runJson = parseJson(workflow.stdout) as Array<{
      databaseId?: number;
      conclusion?: string;
      headSha?: string;
    }>;
    if (typeof commitJson.sha !== 'string') {
      return unknown(checkedAt, 'GitHub head response did not contain a commit SHA.');
    }
    const latest = runJson[0];
    return ok(
      checkedAt,
      {
        repository,
        branch,
        headSha: commitJson.sha,
        ...(latest
          ? {
              latestRun: {
                id: latest.databaseId,
                conclusion: latest.conclusion,
                headSha: latest.headSha,
              },
            }
          : {}),
      },
      `GitHub ${repository}:${branch} @ ${commitJson.sha}; latest CI ${latest?.conclusion ?? 'unknown'}.`,
    );
  } catch (error) {
    return unknown(checkedAt, 'GitHub CLI or authentication is unavailable.', error);
  }
}

async function collectSupabase(
  queryTables: QueryTables,
  checkedAt: string,
  timeoutMs: number,
  databaseUrl?: string,
): Promise<ObservedState['supabase']> {
  if (!databaseUrl) {
    return unknown(
      checkedAt,
      'DATABASE_URL is unavailable; live table state was not queried.',
    );
  }
  try {
    const tables = [...(await queryTables(databaseUrl, TABLE_QUERY, timeoutMs))].sort();
    return ok(
      checkedAt,
      { tables },
      `Read ${tables.length} public table names from information_schema.tables.`,
    );
  } catch (error) {
    return unknown(checkedAt, 'Live table inventory query was unavailable.', error);
  }
}

async function responseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return parseJson(text);
  } catch {
    return undefined;
  }
}

async function collectRailwayApi(
  fetcher: CollectorFetch,
  checkedAt: string,
  timeoutMs: number,
  environment: CollectorEnvironment,
): Promise<ObservedState['railwayApi']> {
  const base = environment.railway.api.public_url;
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    const [health, missionControl, memoryIngest] = await Promise.all([
      fetcher(safeUrl(base, environment.railway.api.health_path), { signal }),
      fetcher(safeUrl(base, '/v1/status/mission_control'), { method: 'GET', signal }),
      fetcher(safeUrl(base, '/v1/memory/ingest'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
        signal,
      }),
    ]);
    const healthBody = await responseJson(health);
    const ingestExists = [200, 201, 202, 204, 400, 401, 403, 415, 422].includes(
      memoryIngest.status,
    );
    const value = {
      healthStatus: health.status,
      fingerprint: fingerprint(healthBody),
      routes: {
        missionControl: {
          method: 'GET' as const,
          path: '/v1/status/mission_control',
          status: missionControl.status,
          exists: missionControl.status !== 404,
        },
        memoryIngest: {
          method: 'POST' as const,
          path: '/v1/memory/ingest',
          status: memoryIngest.status,
          exists: ingestExists,
        },
      },
    };
    const status = health.ok && memoryIngest.status !== 404 ? 'ok' : 'drift';
    return {
      status,
      checkedAt,
      value,
      evidence: `GET /healthz ${health.status}; GET /v1/status/mission_control ${missionControl.status}; POST /v1/memory/ingest ${memoryIngest.status}.`,
    };
  } catch (error) {
    return unknown(checkedAt, 'Railway API probes were unavailable.', error);
  }
}

async function collectRailwayOs(
  fetcher: CollectorFetch,
  checkedAt: string,
  timeoutMs: number,
  environment: CollectorEnvironment,
): Promise<ObservedState['railwayOs']> {
  try {
    const response = await fetcher(
      safeUrl(
        environment.railway.os.public_url,
        environment.railway.os.health_path,
      ),
      { signal: AbortSignal.timeout(timeoutMs) },
    );
    return {
      status: response.ok ? 'ok' : 'drift',
      checkedAt,
      value: { status: response.status, fingerprint: fingerprint(await responseJson(response)) },
      evidence: `GET ${environment.railway.os.health_path} returned ${response.status}.`,
    };
  } catch (error) {
    return unknown(checkedAt, 'Railway OS build metadata probe was unavailable.', error);
  }
}

async function collectRegistry(
  root: string,
  checkedAt: string,
): Promise<ObservedState['registry']> {
  const source = 'apps/api/src/routes.gen.ts';
  try {
    const content = await readFile(join(root, ...source.split('/')), 'utf8');
    const match = /GENERATED_CAPABILITY_IDS\s*=\s*\[([\s\S]*?)\]\s*as const/.exec(content);
    if (!match) {
      return {
        status: 'error',
        checkedAt,
        evidence: 'Generated capability identifier array was not found.',
      };
    }
    const generatedRouteCount = [...match[1].matchAll(/["'][^"']+["']/g)].length;
    return ok(
      checkedAt,
      { generatedRouteCount, source },
      `Counted ${generatedRouteCount} generated routes in ${source}.`,
    );
  } catch (error) {
    return {
      status: 'error',
      checkedAt,
      evidence: `Could not read ${source}.`,
      error: safeError(error),
    };
  }
}

export async function collectObservedState(
  options: CollectObservedStateOptions,
): Promise<ObservedState> {
  const checkedAt = options.collectedAt ?? new Date().toISOString();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const run = options.run ?? defaultRun;
  const fetcher = options.fetch ?? defaultFetch;
  const queryTables = options.queryTables ?? defaultQueryTables;
  const injected = Boolean(options.run || options.fetch || options.queryTables);

  const [localGit, github, supabase, railwayApi, railwayOs, registry] =
    await Promise.all([
      collectLocalGit(run, options.root, checkedAt, timeoutMs),
      collectGithub(run, options.root, checkedAt, timeoutMs, options.environment),
      collectSupabase(
        queryTables,
        checkedAt,
        timeoutMs,
        options.databaseUrl,
      ),
      collectRailwayApi(fetcher, checkedAt, timeoutMs, options.environment),
      collectRailwayOs(fetcher, checkedAt, timeoutMs, options.environment),
      collectRegistry(options.root, checkedAt),
    ]);

  return {
    schemaVersion: 1,
    collectedAt: checkedAt,
    provenance: {
      collector: '@atlas/control-schema',
      mode: injected ? 'injected' : 'live-read-only',
      sources: [
        'local git',
        'GitHub CLI',
        'Supabase information_schema.tables',
        'Railway API public probes',
        'Railway OS build-info.json',
        'apps/api/src/routes.gen.ts',
      ],
    },
    localGit,
    github,
    supabase,
    railwayApi,
    railwayOs,
    registry,
  };
}

function handoffUpdatedAt(handoff: string): string | undefined {
  const value = /^\*\*Updated:\*\*\s*(.+?)\s*$/im.exec(handoff)?.[1]?.trim();
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? undefined : parsed.toISOString();
}

async function main(): Promise<void> {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  const root = resolve(moduleDirectory, '../../..');
  const control = await loadControlFiles(root);
  const environment = control.environments.environments.production;
  const staticVerificationFindings = await verifyStatic(root);
  const observed = await collectObservedState({
    root,
    environment,
    databaseUrl: process.env.DATABASE_URL,
  });
  const desired: DesiredState = {
    phase: 'P1 deployment closure',
    phaseComplete: false,
    acceptanceEvidence: [],
    requiredTables: environment.supabase.required_tables,
    handoffUpdatedAt: handoffUpdatedAt(control.currentHandoff),
    staticVerificationFindings,
    now: observed.collectedAt,
  };
  const findings = detectDrift(desired, observed);
  await writeObservedState(root, observed, findings);
  for (const finding of findings) {
    console.log(`${finding.severity.toUpperCase()} ${finding.code}: ${finding.message}`);
  }
  console.log('Wrote docs/control/generated/observed-state.json and drift-report.md');
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === resolve(fileURLToPath(import.meta.url))) {
  await main();
}
