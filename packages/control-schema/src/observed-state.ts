import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DriftFinding } from './drift.js';
import { renderDriftReport } from './drift.js';
import { containsSecret, redactSecrets } from './secrets.js';

export { redactSecrets } from './secrets.js';

export type ObservationStatus = 'ok' | 'drift' | 'unknown' | 'error';

export interface Observation<T> {
  status: ObservationStatus;
  checkedAt: string;
  value?: T;
  evidence?: string;
  error?: string;
}

export interface BuildFingerprint {
  service?: string;
  appVersion?: string;
  gitSha?: string;
  buildTime?: string;
  schemaVersion?: string;
  registryVersion?: number;
}

export interface RouteProbe {
  method: 'GET' | 'POST';
  path: string;
  status?: number;
  exists?: boolean;
}

export interface ObservedState {
  schemaVersion: 1;
  collectedAt: string;
  provenance: {
    collector: '@atlas/control-schema';
    mode: 'injected' | 'live-read-only';
    sources: string[];
  };
  localGit: Observation<{ branch: string; sha: string }>;
  github: Observation<{
    repository: string;
    branch: string;
    headSha: string;
    latestRun?: { id?: number; conclusion?: string; headSha?: string };
  }>;
  supabase: Observation<{ tables: string[]; migration?: string }>;
  railwayApi: Observation<{
    healthStatus?: number;
    fingerprint?: BuildFingerprint;
    routes: {
      missionControl: RouteProbe;
      memoryIngest: RouteProbe;
    };
  }>;
  railwayOs: Observation<{
    status?: number;
    fingerprint?: BuildFingerprint;
  }>;
  registry: Observation<{
    version: number;
    capabilityCount: number;
    generatedRouteCount: number;
    source: string;
    generatedSource: string;
  }>;
}

function redactForOutput<T>(value: T): T {
  if (typeof value === 'string') {
    return redactSecrets(value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactForOutput(entry)) as T;
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry], index) => [
        containsSecret(key) ? `[redacted-key-${index}]` : key,
        redactForOutput(entry),
      ]),
    ) as T;
  }
  return value;
}

export async function writeObservedState(
  root: string,
  observed: ObservedState,
  findings: DriftFinding[],
): Promise<void> {
  const outputDirectory = join(root, 'docs', 'control', 'generated');
  const safeObserved = redactForOutput(observed);
  const safeFindings = redactForOutput(findings);
  await mkdir(outputDirectory, { recursive: true });
  await Promise.all([
    writeFile(
      join(outputDirectory, 'observed-state.json'),
      `${JSON.stringify(safeObserved, null, 2)}\n`,
      'utf8',
    ),
    writeFile(
      join(outputDirectory, 'drift-report.md'),
      renderDriftReport(safeObserved, safeFindings),
      'utf8',
    ),
  ]);
}
