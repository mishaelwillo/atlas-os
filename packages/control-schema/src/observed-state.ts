import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DriftFinding } from './drift.js';
import { renderDriftReport } from './drift.js';

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
  supabase: Observation<{ tables: string[] }>;
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
    generatedRouteCount: number;
    source: string;
  }>;
}

export async function writeObservedState(
  root: string,
  observed: ObservedState,
  findings: DriftFinding[],
): Promise<void> {
  const outputDirectory = join(root, 'docs', 'control', 'generated');
  await mkdir(outputDirectory, { recursive: true });
  await Promise.all([
    writeFile(
      join(outputDirectory, 'observed-state.json'),
      `${JSON.stringify(observed, null, 2)}\n`,
      'utf8',
    ),
    writeFile(
      join(outputDirectory, 'drift-report.md'),
      renderDriftReport(observed, findings),
      'utf8',
    ),
  ]);
}
