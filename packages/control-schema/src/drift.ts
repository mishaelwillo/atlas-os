import type { Finding } from './schemas.js';
import type { ObservedState } from './observed-state.js';

export type DriftSeverity = 'info' | 'warning' | 'blocking';

export interface DriftFinding {
  severity: DriftSeverity;
  code: string;
  message: string;
}

export interface DesiredState {
  phase: string;
  phaseComplete: boolean;
  acceptanceEvidence: string[];
  requiredTables: string[];
  handoffUpdatedAt?: string;
  staticVerificationFindings: Finding[];
  now?: string;
}

const SEVERITY_ORDER: Record<DriftSeverity, number> = {
  blocking: 0,
  warning: 1,
  info: 2,
};

function finding(
  severity: DriftSeverity,
  code: string,
  message: string,
): DriftFinding {
  return { severity, code, message };
}

function knownSha(value: string | undefined): value is string {
  return Boolean(value && value !== 'unknown');
}

function ageMilliseconds(earlier: string, later: string): number | undefined {
  const earlierTime = Date.parse(earlier);
  const laterTime = Date.parse(later);
  if (!Number.isFinite(earlierTime) || !Number.isFinite(laterTime)) {
    return undefined;
  }
  return laterTime - earlierTime;
}

function compareCodepoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function sortDriftFindings(findings: DriftFinding[]): DriftFinding[] {
  return [...findings].sort(
    (left, right) =>
      SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity] ||
      compareCodepoints(left.code, right.code) ||
      compareCodepoints(left.message, right.message),
  );
}

export function detectDrift(
  desired: DesiredState,
  observed: ObservedState,
): DriftFinding[] {
  const findings: DriftFinding[] = [];
  const githubSha = observed.github.value?.headSha;
  const apiSha = observed.railwayApi.value?.fingerprint?.gitSha;
  const ingestStatus = observed.railwayApi.value?.routes.memoryIngest.status;

  if (knownSha(githubSha) && knownSha(apiSha) && githubSha !== apiSha) {
    findings.push(
      finding(
        'blocking',
        'railway.api.sha_mismatch',
        `Railway API SHA ${apiSha} differs from selected GitHub SHA ${githubSha}.`,
      ),
    );
  }

  if (ingestStatus === 404) {
    findings.push(
      finding(
        'blocking',
        'railway.api.route_missing',
        'POST /v1/memory/ingest returned 404.',
      ),
    );
  } else if (
    observed.railwayApi.status === 'drift' ||
    observed.railwayApi.status === 'error'
  ) {
    findings.push(
      finding(
        'blocking',
        'railway.api.probe_invalid',
        'Railway API probes did not satisfy the required status and body contracts.',
      ),
    );
  }

  if (observed.supabase.status === 'ok' && observed.supabase.value) {
    const present = new Set(observed.supabase.value.tables);
    const missing = desired.requiredTables
      .filter((table) => !present.has(table))
      .sort(compareCodepoints);
    if (missing.length > 0) {
      findings.push(
        finding(
          'blocking',
          'supabase.required_tables_missing',
          `Required public tables are missing: ${missing.join(', ')}.`,
        ),
      );
    }
  }

  if (desired.phaseComplete && desired.acceptanceEvidence.length === 0) {
    findings.push(
      finding(
        'blocking',
        'phase.acceptance_evidence_missing',
        `${desired.phase} is declared complete without acceptance evidence.`,
      ),
    );
  }

  if (
    desired.staticVerificationFindings.some(
      (staticFinding) => staticFinding.severity === 'blocking',
    )
  ) {
    findings.push(
      finding(
        'blocking',
        'control.static_verification_failed',
        'Static continuity verification has blocking findings.',
      ),
    );
  }

  if (!knownSha(apiSha)) {
    findings.push(
      finding(
        'warning',
        'railway.api.fingerprint_unknown',
        'Railway API deployment fingerprint is unknown.',
      ),
    );
  }
  if (observed.railwayOs.status !== 'ok' || !knownSha(observed.railwayOs.value?.fingerprint?.gitSha)) {
    findings.push(
      finding(
        'warning',
        'railway.os.fingerprint_unknown',
        'Railway OS deployment fingerprint is unknown.',
      ),
    );
  }
  if (observed.github.status !== 'ok') {
    findings.push(
      finding('warning', 'github.state_unknown', 'GitHub head or CI state is unknown.'),
    );
  }
  if (observed.supabase.status !== 'ok') {
    findings.push(
      finding(
        'warning',
        'supabase.live_state_unknown',
        'Live Supabase table state is unknown.',
      ),
    );
  }

  const now = desired.now ?? new Date().toISOString();
  if (ageMilliseconds(observed.collectedAt, now) === undefined) {
    findings.push(
      finding(
        'warning',
        'control.observed_state_timestamp_invalid',
        'Observed-state collection time is invalid or unavailable.',
      ),
    );
  }
  if (
    desired.handoffUpdatedAt &&
    (ageMilliseconds(desired.handoffUpdatedAt, now) ?? 0) > 24 * 60 * 60 * 1_000
  ) {
    findings.push(
      finding(
        'warning',
        'control.handoff_stale',
        'The active handoff is older than 24 hours.',
      ),
    );
  }
  if ((ageMilliseconds(observed.collectedAt, now) ?? 0) > 60 * 60 * 1_000) {
    findings.push(
      finding(
        'warning',
        'control.observed_state_stale',
        'Observed state is older than 60 minutes.',
      ),
    );
  }

  return sortDriftFindings(findings);
}

function evidenceLine(label: string, status: string, evidence?: string): string {
  return `- ${label}: ${status}${evidence ? ` — ${evidence}` : ''}`;
}

export function renderDriftReport(
  observed: ObservedState,
  findings: DriftFinding[],
): string {
  const sorted = sortDriftFindings(findings);
  const sections: Array<[string, DriftSeverity]> = [
    ['Blocking', 'blocking'],
    ['Warning', 'warning'],
    ['Info', 'info'],
  ];
  const lines = ['# Atlas Drift Report', '', `Generated: ${observed.collectedAt}`, ''];

  for (const [heading, severity] of sections) {
    lines.push(`## ${heading}`);
    const matching = sorted.filter((item) => item.severity === severity);
    if (matching.length === 0) {
      lines.push('- None.');
    } else {
      lines.push(...matching.map((item) => `- [${item.code}] ${item.message}`));
    }
    lines.push('');
  }

  lines.push(
    '## Evidence',
    evidenceLine('Local Git', observed.localGit.status, observed.localGit.evidence),
    evidenceLine('GitHub', observed.github.status, observed.github.evidence),
    evidenceLine('Supabase', observed.supabase.status, observed.supabase.evidence),
    evidenceLine('Railway API', observed.railwayApi.status, observed.railwayApi.evidence),
    evidenceLine('Railway OS', observed.railwayOs.status, observed.railwayOs.evidence),
    evidenceLine('Registry', observed.registry.status, observed.registry.evidence),
    '',
    `Collector: ${observed.provenance.collector} (${observed.provenance.mode})`,
    '',
  );

  return `${lines.join('\n')}\n`;
}
