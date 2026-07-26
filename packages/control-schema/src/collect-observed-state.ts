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
  redactSecrets,
  writeObservedState,
} from './observed-state.js';
import { verifyStatic } from './verify-static.js';

const execFileAsync = promisify(execFile);
const TABLE_QUERY = `select table_name
from information_schema.tables
where table_schema = 'public'
order by table_name`;
const MIGRATION_QUERY = `select version || '_' || name as migration_identity
from supabase_migrations.schema_migrations
order by version desc
limit 1`;
const DEFAULT_TIMEOUT_MS = 15_000;

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
) => Promise<unknown>;

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

export interface RunStatusCliOptions extends CollectObservedStateOptions {
  desired: DesiredState;
  writeLine?: (line: string) => void;
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return redactSecrets(message).slice(0, 500);
}

function safeUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

function compareCodepoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
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
): Promise<unknown> {
  if (sql !== TABLE_QUERY && sql !== MIGRATION_QUERY) {
    throw new Error('Only approved read-only Supabase observation queries are allowed.');
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
    if (sql === TABLE_QUERY) {
      const result = await client.query<{ table_name: string }>(TABLE_QUERY);
      return result.rows.map((row) => row.table_name);
    }
    const result = await client.query<{ migration_identity: string }>(MIGRATION_QUERY);
    return result.rows[0]?.migration_identity;
  } finally {
    await client.end().catch(() => undefined);
  }
}

function parseJson(text: string): unknown {
  return JSON.parse(text.trim());
}

function validatedFingerprint(
  value: unknown,
  expectedService: 'atlas-api' | 'atlas-os',
  requireOk: boolean,
): { fingerprint?: BuildFingerprint; error?: string } {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { error: `${expectedService} fingerprint body is not a JSON object.` };
  }
  const source = value as Record<string, unknown>;
  if (requireOk && source.ok !== true) {
    return { error: `${expectedService} fingerprint body does not report ok=true.` };
  }
  if (source.service !== expectedService) {
    return { error: `${expectedService} fingerprint has an unexpected service field.` };
  }
  if (typeof source.appVersion !== 'string' || source.appVersion.trim() === '') {
    return { error: `${expectedService} fingerprint has no application version.` };
  }
  if (
    typeof source.gitSha !== 'string' ||
    (source.gitSha !== 'unknown' && !/^[0-9a-f]{7,64}$/i.test(source.gitSha))
  ) {
    return { error: `${expectedService} fingerprint has an invalid Git SHA.` };
  }
  if (
    typeof source.buildTime !== 'string' ||
    (source.buildTime !== 'unknown' && !Number.isFinite(Date.parse(source.buildTime)))
  ) {
    return { error: `${expectedService} fingerprint has an invalid build time.` };
  }
  if (typeof source.schemaVersion !== 'string' || source.schemaVersion.trim() === '') {
    return { error: `${expectedService} fingerprint has no schema version.` };
  }
  if (
    typeof source.registryVersion !== 'number' ||
    !Number.isInteger(source.registryVersion) ||
    source.registryVersion < 1
  ) {
    return { error: `${expectedService} fingerprint has an invalid registry version.` };
  }
  return {
    fingerprint: {
      service: expectedService,
      appVersion: source.appVersion,
      gitSha: source.gitSha,
      buildTime: source.buildTime,
      schemaVersion: source.schemaVersion,
      registryVersion: source.registryVersion,
    },
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
      return unknown(
        checkedAt,
        'Local Git identity could not be read.',
        `${branch.stderr}\n${sha.stderr}`,
      );
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
          '--workflow',
          'ci.yml',
          '--limit',
          '1',
          '--json',
          'databaseId,conclusion,headSha',
        ],
        { cwd: root, timeoutMs },
      ),
    ]);
    if (commit.exitCode !== 0 || workflow.exitCode !== 0) {
      return unknown(
        checkedAt,
        'GitHub CLI did not return head and CI evidence.',
        `${commit.stderr}\n${workflow.stderr}`,
      );
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
    const value = {
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
    };
    const conclusion = latest?.conclusion?.trim();
    const terminalConclusions = new Set([
      'success',
      'failure',
      'cancelled',
      'skipped',
      'timed_out',
      'action_required',
      'neutral',
      'stale',
      'startup_failure',
    ]);
    if (!conclusion || !terminalConclusions.has(conclusion)) {
      return {
        status: 'unknown',
        checkedAt,
        value,
        evidence: `GitHub ${repository}:${branch} @ ${commitJson.sha}; CI conclusion is unknown or non-terminal.`,
      };
    }
    const exactSha = latest?.headSha === commitJson.sha;
    const status = conclusion === 'success' && exactSha ? 'ok' : 'drift';
    return {
      status,
      checkedAt,
      value,
      evidence: `GitHub ${repository}:${branch} @ ${commitJson.sha}; latest CI ${conclusion} @ ${latest?.headSha ?? 'unknown'}.`,
      ...(status === 'ok'
        ? {}
        : {
            error:
              conclusion === 'success'
                ? 'Latest successful CI run does not match the observed repository head SHA.'
                : `Latest CI run concluded ${conclusion}.`,
          }),
    };
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
    const [tableResponse, migrationResponse] = await Promise.all([
      queryTables(databaseUrl, TABLE_QUERY, timeoutMs),
      queryTables(databaseUrl, MIGRATION_QUERY, timeoutMs),
    ]);
    if (
      !Array.isArray(tableResponse) ||
      !tableResponse.every((table): table is string => typeof table === 'string')
    ) {
      throw new Error('Live table inventory response was malformed.');
    }
    if (
      migrationResponse !== undefined &&
      (typeof migrationResponse !== 'string' || migrationResponse.length === 0)
    ) {
      throw new Error('Supabase migration history response was malformed.');
    }
    const tables = [...tableResponse].sort(compareCodepoints);
    return ok(
      checkedAt,
      {
        tables,
        ...(migrationResponse === undefined
          ? {}
          : { migration: migrationResponse }),
      },
      `Read ${tables.length} public table names and the latest migration identity from approved read-only queries.`,
    );
  } catch (error) {
    return unknown(
      checkedAt,
      'Live table or migration-history observation was unavailable.',
      error,
    );
  }
}

async function responseJson(
  response: Response,
): Promise<{ parsed: boolean; value?: unknown }> {
  const text = await response.text();
  if (!text) return { parsed: false };
  try {
    return { parsed: true, value: parseJson(text) };
  } catch {
    return { parsed: false };
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
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
    const [healthBody, missionBody, ingestBody] = await Promise.all([
      responseJson(health),
      responseJson(missionControl),
      responseJson(memoryIngest),
    ]);
    const healthValidation =
      health.status === 200 && healthBody.parsed
        ? validatedFingerprint(healthBody.value, 'atlas-api', true)
        : {
            error:
              health.status !== 200
                ? `API health returned unexpected status ${health.status}.`
                : 'API health returned malformed JSON.',
          };
    const missionBodyValid =
      missionControl.status === 200 &&
      missionBody.parsed &&
      isObject(missionBody.value) &&
      missionBody.value.ok === true &&
      Array.isArray(missionBody.value.cards);
    const missionProtected = [401, 403].includes(missionControl.status);
    const missionExists = missionBodyValid || missionProtected;
    const ingestExists =
      [400, 401, 403, 415].includes(memoryIngest.status) &&
      ingestBody.parsed &&
      isObject(ingestBody.value);
    const errors = [
      healthValidation.error,
      ...(missionExists
        ? []
        : [
            `Mission Control probe returned invalid status or body (${missionControl.status}).`,
          ]),
      ...(ingestExists || memoryIngest.status === 404
        ? []
        : [`Memory ingest probe returned unexpected status or body (${memoryIngest.status}).`]),
    ].filter((entry): entry is string => Boolean(entry));
    const value = {
      healthStatus: health.status,
      fingerprint: healthValidation.fingerprint,
      routes: {
        missionControl: {
          method: 'GET' as const,
          path: '/v1/status/mission_control',
          status: missionControl.status,
          exists: missionExists,
        },
        memoryIngest: {
          method: 'POST' as const,
          path: '/v1/memory/ingest',
          status: memoryIngest.status,
          exists: ingestExists,
        },
      },
    };
    const status =
      memoryIngest.status === 404
        ? 'drift'
        : errors.length === 0
          ? 'ok'
          : 'error';
    return {
      status,
      checkedAt,
      value,
      evidence: `GET /healthz ${health.status}; GET /v1/status/mission_control ${missionControl.status}; POST /v1/memory/ingest ${memoryIngest.status}.`,
      ...(status === 'ok'
        ? {}
        : {
            error: redactSecrets(
              memoryIngest.status === 404
                ? 'POST /v1/memory/ingest is missing.'
                : errors.join(' '),
            ),
          }),
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
    const body = await responseJson(response);
    const validation =
      response.status === 200 && body.parsed
        ? validatedFingerprint(body.value, 'atlas-os', false)
        : {
            error:
              response.status !== 200
                ? `OS build metadata returned unexpected status ${response.status}.`
                : 'OS build metadata returned malformed JSON.',
          };
    return {
      status: validation.fingerprint ? 'ok' : 'error',
      checkedAt,
      value: { status: response.status, fingerprint: validation.fingerprint },
      evidence: `GET ${environment.railway.os.health_path} returned ${response.status}.`,
      ...(validation.error ? { error: redactSecrets(validation.error) } : {}),
    };
  } catch (error) {
    return unknown(checkedAt, 'Railway OS build metadata probe was unavailable.', error);
  }
}

async function collectRegistry(
  root: string,
  checkedAt: string,
): Promise<ObservedState['registry']> {
  const source = 'packages/registry/registry.ts';
  const generatedSource = 'apps/api/src/routes.gen.ts';
  try {
    const [registryContent, generatedContent] = await Promise.all([
      readFile(join(root, ...source.split('/')), 'utf8'),
      readFile(join(root, ...generatedSource.split('/')), 'utf8'),
    ]);
    const versionMatch = /export const REGISTRY_VERSION\s*=\s*(\d+)\s*;/.exec(
      registryContent,
    );
    const generatedMatch =
      /GENERATED_CAPABILITY_IDS\s*=\s*\[([\s\S]*?)\]\s*as const/.exec(
        generatedContent,
      );
    if (!versionMatch || !generatedMatch) {
      return unknown(
        checkedAt,
        'Local registry version or generated capability identifiers are unavailable.',
      );
    }
    const version = Number(versionMatch[1]);
    const capabilityCount = [...registryContent.matchAll(/\bid:\s*'[^']+'/g)].length;
    const generatedRouteCount = [
      ...generatedMatch[1].matchAll(/["'][^"']+["']/g),
    ].length;
    return ok(
      checkedAt,
      { version, capabilityCount, generatedRouteCount, source, generatedSource },
      `Read registry version ${version} and reconciled ${capabilityCount} capabilities with ${generatedRouteCount} generated routes.`,
    );
  } catch (error) {
    return unknown(checkedAt, `Could not read ${source} or ${generatedSource}.`, error);
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
        'Supabase information_schema.tables and supabase_migrations.schema_migrations',
        'Railway API public probes',
        'Railway OS build-info.json',
        'packages/registry/registry.ts and apps/api/src/routes.gen.ts',
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

export async function runStatusCli(
  options: RunStatusCliOptions,
): Promise<0 | 1> {
  const observed = await collectObservedState(options);
  const findings = detectDrift(
    {
      ...options.desired,
      now: options.desired.now ?? observed.collectedAt,
    },
    observed,
  );
  await writeObservedState(options.root, observed, findings);
  const writeLine = options.writeLine ?? console.log;
  for (const finding of findings) {
    writeLine(`${finding.severity.toUpperCase()} ${finding.code}: ${finding.message}`);
  }
  writeLine('Wrote docs/control/generated/observed-state.json and drift-report.md');
  return findings.some((finding) => finding.severity === 'blocking') ? 1 : 0;
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
  const desired: DesiredState = {
    phase: 'P1 deployment closure',
    phaseComplete: false,
    acceptanceEvidence: [],
    requiredTables: environment.supabase.required_tables,
    expectedMigration: environment.supabase.expected_migration,
    handoffUpdatedAt: handoffUpdatedAt(control.currentHandoff),
    staticVerificationFindings,
  };
  process.exitCode = await runStatusCli({
    root,
    environment,
    databaseUrl: process.env.DATABASE_URL,
    desired,
  });
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === resolve(fileURLToPath(import.meta.url))) {
  await main();
}
