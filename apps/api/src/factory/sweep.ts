/**
 * Re-checking sites that are already live (docs/specs/p2/website-factory.md).
 *
 * The post-publish read-back proves the deployment being made. It says nothing
 * about the ones made before it, and that gap has already cost something real:
 * a published site sat answering 404 for an hour while its deployment row read
 * `live`, because a later publish had replaced the whole project. Nobody
 * noticed until a person loaded the address by hand.
 *
 * So this walks every live deployment and compares what its address serves
 * against the build that was approved for it. It changes no deployment state —
 * a site that has gone wrong is still the site that is public, and quietly
 * marking it otherwise would put the record further from reality rather than
 * closer. It records the observation and says which ones are wrong.
 *
 * The comparison is pure; reading the addresses is the caller's job.
 */
import { classifyFingerprint, type FingerprintVerdict, type ReadPublicResult } from './fingerprint.js';

export interface LiveDeploymentRef {
  deploymentId: string;
  siteId: string;
  domain: string | null;
  buildHash: string;
}

export interface SweepEntry {
  deploymentId: string;
  siteId: string;
  domain: string | null;
  verdict: FingerprintVerdict | 'no_address';
  observed: string | null;
  approved: string;
  message: string;
}

export interface SweepSummary {
  checked: number;
  matching: number;
  /** Live deployments whose address does not serve the approved build. */
  mismatched: SweepEntry[];
  /** Live deployments whose address could not be read at all. */
  unreadable: SweepEntry[];
  /** True when every live deployment serves what was approved for it. */
  healthy: boolean;
}

/**
 * Classify one live deployment.
 *
 * A row with no recorded address is reported as `no_address` rather than
 * skipped. It means something was marked live without anywhere to serve from,
 * which is a defect in its own right and should not vanish from the count.
 */
export function classifyLive(
  deployment: LiveDeploymentRef,
  read: ReadPublicResult | null,
  error?: string | null,
): SweepEntry {
  if (deployment.domain === null || deployment.domain.trim() === '') {
    return {
      deploymentId: deployment.deploymentId,
      siteId: deployment.siteId,
      domain: null,
      verdict: 'no_address',
      observed: null,
      approved: deployment.buildHash,
      message: 'this deployment is live but records no address, so nothing can be checked',
    };
  }

  const result = classifyFingerprint({ approved: deployment.buildHash, read, error });
  return {
    deploymentId: deployment.deploymentId,
    siteId: deployment.siteId,
    domain: deployment.domain,
    verdict: result.verdict,
    observed: result.observed,
    approved: result.approved,
    message: result.message,
  };
}

/**
 * Summarise a sweep.
 *
 * `healthy` requires every deployment to match. An unreadable address is not
 * healthy: the whole point is that a site nobody can load is exactly the
 * failure this exists to surface, and counting it as "probably fine" would
 * reproduce the silence that made the original defect last an hour.
 */
export function summariseSweep(entries: readonly SweepEntry[]): SweepSummary {
  const mismatched = entries.filter((e) => e.verdict === 'mismatch' || e.verdict === 'no_address');
  const unreadable = entries.filter((e) => e.verdict === 'unreadable');
  const matching = entries.filter((e) => e.verdict === 'match').length;

  return {
    checked: entries.length,
    matching,
    mismatched: [...mismatched],
    unreadable: [...unreadable],
    healthy: entries.length === matching,
  };
}
