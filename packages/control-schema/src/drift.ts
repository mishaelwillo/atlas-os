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
  expectedMigration: string;
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
  const latestCi = observed.github.value?.latestRun;

  if (observed.github.status === 'drift') {
    if (
      latestCi?.conclusion === 'success' &&
      latestCi.headSha !== observed.github.value?.headSha
    ) {
      findings.push(
        finding(
          'blocking',
          'github.ci_sha_mismatch',
          `Latest successful CI SHA ${latestCi.headSha ?? 'unknown'} differs from GitHub head ${observed.github.value?.headSha ?? 'unknown'}.`,
        ),
      );
    } else {
      findings.push(
        finding(
          'blocking',
          'github.ci_unsuccessful',
          `Latest CI run concluded ${latestCi?.conclusion ?? 'unknown'}.`,
        ),
      );
    }
  }

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
    const migration = observed.supabase.value.migration;
    if (migration === undefined) {
      findings.push(
        finding(
          'blocking',
          'supabase.migration_missing',
          `Expected Supabase migration ${desired.expectedMigration}, but migration history is empty.`,
        ),
      );
    } else if (migration !== desired.expectedMigration) {
      findings.push(
        finding(
          'blocking',
          'supabase.migration_mismatch',
          `Observed Supabase migration ${migration} differs from expected ${desired.expectedMigration}.`,
        ),
      );
    }
  }

  const localRegistry = observed.registry.value;
  if (observed.registry.status === 'ok' && localRegistry) {
    if (localRegistry.capabilityCount !== localRegistry.generatedRouteCount) {
      findings.push(
        finding(
          'blocking',
          'registry.route_count_mismatch',
          `Registry has ${localRegistry.capabilityCount} capabilities but generated routes contain ${localRegistry.generatedRouteCount}.`,
        ),
      );
    }
    /*
     * Compare what each service *claims* about the schema against expectation.
     * Nothing else does this: the Supabase check compares the database against
     * ENVIRONMENTS.yaml, and never against a running service's own fingerprint,
     * so a stale-but-well-formed schemaVersion passed every gate. An admitted
     * 'unknown' is honest and is not a claim, so only a specific wrong value
     * is reported.
     */
    for (const [service, claimed] of [
      ['api', observed.railwayApi.value?.fingerprint?.schemaVersion],
      ['os', observed.railwayOs.value?.fingerprint?.schemaVersion],
    ] as const) {
      if (claimed === undefined || claimed === 'unknown') continue;
      if (claimed !== desired.expectedMigration) {
        findings.push(
          finding(
            'blocking',
            `railway.${service}.schema_claim_mismatch`,
            `Railway ${service.toUpperCase()} reports schema ${claimed} but ${desired.expectedMigration} is expected.`,
          ),
        );
      }
    }

    const deployedVersions = [
      observed.railwayApi.value?.fingerprint?.registryVersion,
      observed.railwayOs.value?.fingerprint?.registryVersion,
    ];
    const mismatched = deployedVersions.filter(
      (version): version is number =>
        version !== undefined && version !== localRegistry.version,
    );
    if (mismatched.length > 0) {
      findings.push(
        finding(
          'blocking',
          'registry.version_mismatch',
          `Deployed registry version ${[...new Set(mismatched)].join(', ')} differs from local authority ${localRegistry.version}.`,
        ),
      );
    } else if (deployedVersions.some((version) => version === undefined)) {
      findings.push(
        finding(
          'warning',
          'registry.deployed_version_unknown',
          'One or more deployed registry versions are unknown.',
        ),
      );
    }
  }

  /*
   * Site hosting. Until this existed, hosting configuration had no schema and
   * no detector: the Pages project, account and public address lived as prose,
   * so pointing the publisher at a different project — or losing the
   * credential entirely — was invisible until someone noticed sites were not
   * appearing. The hourly factory.verify_live sweep catches the symptom; these
   * catch the cause.
   *
   * All of this is skipped when the observation is `unknown`, because a
   * collector that could not read the API environment must not be turned into
   * evidence of a mismatch.
   */
  const hosting = observed.hosting.value;
  if (observed.hosting.status !== 'unknown' && hosting) {
    const configured = hosting.configured;
    if (configured?.accountId !== undefined && configured.accountId !== hosting.declared.accountId) {
      findings.push(
        finding(
          'blocking',
          'hosting.account_mismatch',
          `The API publishes to Cloudflare account ${configured.accountId} but ${hosting.declared.accountId} is declared.`,
        ),
      );
    }
    if (
      configured?.pagesProject !== undefined &&
      configured.pagesProject !== hosting.declared.pagesProject
    ) {
      findings.push(
        finding(
          'blocking',
          'hosting.pages_project_mismatch',
          `The API publishes to Pages project ${configured.pagesProject} but ${hosting.declared.pagesProject} is declared.`,
        ),
      );
    }
    /*
     * A base-URL mismatch is blocking because the address is RECORDED on the
     * deployment row and read back to produce a fingerprint. Publishing
     * against the wrong base means every recorded address, and every
     * fingerprint taken from it, describes somewhere the site is not.
     */
    if (
      configured?.baseUrl !== undefined &&
      configured.baseUrl.replace(/\/+$/, '') !==
        hosting.declared.publicBaseUrl.replace(/\/+$/, '')
    ) {
      findings.push(
        finding(
          'blocking',
          'hosting.base_url_mismatch',
          `The API records published addresses under ${configured.baseUrl} but ${hosting.declared.publicBaseUrl} is declared.`,
        ),
      );
    }
    const unset = Object.entries(hosting.variablesSet)
      .filter(([, set]) => !set)
      .map(([name]) => name)
      .sort(compareCodepoints);
    if (unset.length > 0) {
      findings.push(
        finding(
          'blocking',
          'hosting.variables_unset',
          `Hosting variables are not set, so an approved publish is recorded as queued rather than going live: ${unset.join(', ')}.`,
        ),
      );
    }
    if (!hosting.publicReachable) {
      findings.push(
        finding(
          'blocking',
          'hosting.public_address_unreachable',
          `The declared public address ${hosting.declared.publicBaseUrl} did not answer, so no published site is being served from it.`,
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
  if (
    observed.github.status === 'unknown' ||
    observed.github.status === 'error'
  ) {
    findings.push(
      finding('warning', 'github.state_unknown', 'GitHub head or CI state is unknown.'),
    );
  }
  if (observed.supabase.status !== 'ok') {
    findings.push(
      finding(
        'warning',
        'supabase.live_state_unknown',
        'Live Supabase table or migration state is unknown.',
      ),
    );
  }
  if (observed.registry.status !== 'ok') {
    findings.push(
      finding(
        'warning',
        'registry.state_unknown',
        'Local registry version or generated-route state is unknown.',
      ),
    );
  }
  if (observed.hosting.status === 'unknown') {
    findings.push(
      finding(
        'warning',
        'hosting.configuration_unknown',
        'Site hosting configuration is unknown; run the collector with the API environment injected.',
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
  const handoffAge = desired.handoffUpdatedAt
    ? ageMilliseconds(desired.handoffUpdatedAt, now)
    : undefined;
  if (handoffAge === undefined) {
    findings.push(
      finding(
        'warning',
        'control.handoff_timestamp_invalid',
        'The active handoff Updated timestamp is invalid or unavailable.',
      ),
    );
  } else if (handoffAge > 24 * 60 * 60 * 1_000) {
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
    evidenceLine('Site hosting', observed.hosting.status, observed.hosting.evidence),
    evidenceLine('Registry', observed.registry.status, observed.registry.evidence),
    '',
    `Collector: ${observed.provenance.collector} (${observed.provenance.mode})`,
    '',
  );

  return `${lines.join('\n')}\n`;
}
