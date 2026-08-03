/**
 * Publish and rollback (docs/specs/p2/website-factory.md).
 *
 * Acceptance: "public fingerprint equals approved build; rollback proves
 * previous fingerprint healthy."
 *
 * Both halves are decided here as pure functions so the rules are testable
 * without a database, a renderer, or a network.
 */
import type { CombinationIssue } from './templates.js';

export type PublishRefusalCode =
  | 'template_unsatisfied'
  | 'qa_failed'
  | 'build_changed_since_approval'
  | 'already_live';

export interface PublishRefusal {
  ok: false;
  code: PublishRefusalCode;
  message: string;
  issues?: CombinationIssue[];
  /** Blocking QA check ids, when the refusal is `qa_failed`. */
  qaFailures?: string[];
}

export interface PublishPlan {
  ok: true;
  version: number;
  buildHash: string;
  /** The deployment being replaced, if any. */
  supersedes: string | null;
}

export interface LiveDeployment {
  deploymentId: string;
  version: number;
  buildHash: string;
}

export interface PublishInput {
  /** Hash recorded when the operator approved the publish. */
  approvedBuildHash: string;
  /** Hash of re-rendering the stored descriptor right now. */
  currentBuildHash: string | null;
  /** Issues from re-validating the descriptor against its template. */
  renderIssues: CombinationIssue[];
  /**
   * Blocking QA check ids for the build being promoted. Empty means the
   * required accessibility, responsive, link, structured-data, privacy,
   * security and performance checks all passed.
   */
  qaFailures: readonly string[];
  /** Highest version already recorded for this site. */
  latestVersion: number;
  live: LiveDeployment | null;
}

/**
 * Decide whether an approved build may be promoted.
 *
 * The approved hash is re-derived rather than trusted. Rendering is
 * deterministic, so a mismatch means the descriptor changed between approval
 * and publish — exactly the case where publishing would put something live
 * that no one approved.
 *
 * QA is re-decided here for the same reason the hash is. An approval recorded
 * earlier says an operator was willing to publish; it does not say the bytes
 * being promoted still pass the required checks. A build that fails one cannot
 * be published, whoever approved it.
 */
export function planPublish(input: PublishInput): PublishPlan | PublishRefusal {
  if (input.currentBuildHash === null) {
    return {
      ok: false,
      code: 'template_unsatisfied',
      message: 'the descriptor no longer renders; nothing can be published',
      issues: input.renderIssues,
    };
  }
  if (input.qaFailures.length > 0) {
    return {
      ok: false,
      code: 'qa_failed',
      message: `the build fails required QA checks: ${input.qaFailures.join(', ')}`,
      qaFailures: [...input.qaFailures],
    };
  }
  if (input.currentBuildHash !== input.approvedBuildHash) {
    return {
      ok: false,
      code: 'build_changed_since_approval',
      message: `approved build ${short(input.approvedBuildHash)} no longer matches the descriptor, which now renders as ${short(input.currentBuildHash)}`,
    };
  }
  if (input.live && input.live.buildHash === input.approvedBuildHash) {
    return {
      ok: false,
      code: 'already_live',
      message: `build ${short(input.approvedBuildHash)} is already live as version ${input.live.version}`,
    };
  }
  return {
    ok: true,
    version: input.latestVersion + 1,
    buildHash: input.approvedBuildHash,
    supersedes: input.live?.deploymentId ?? null,
  };
}

export type RollbackRefusalCode = 'no_live_deployment' | 'no_healthy_predecessor';

export interface RollbackRefusal {
  ok: false;
  code: RollbackRefusalCode;
  message: string;
}

export interface RollbackPlan {
  ok: true;
  version: number;
  /** The deployment whose build is being restored. */
  target: LiveDeployment;
  supersedes: string;
}

export interface DeploymentRecord {
  deploymentId: string;
  version: number;
  buildHash: string;
  status: string;
  /** True when this deployment was observed serving while it was live. */
  wentLive: boolean;
}

/**
 * Choose what a rollback restores.
 *
 * Only a deployment that actually went live qualifies. A build that was queued
 * and never served has not been proven healthy, so restoring it would be a
 * fresh deploy wearing a rollback's clothes — which is the opposite of what a
 * rollback is for.
 *
 * The restore is recorded as a new version rather than by reviving the old
 * row, so history stays append-only and the sequence of what was public
 * remains readable.
 */
export function planRollback(
  history: readonly DeploymentRecord[],
  latestVersion: number,
): RollbackPlan | RollbackRefusal {
  const live = history.find((d) => d.status === 'live');
  if (!live) {
    return { ok: false, code: 'no_live_deployment', message: 'nothing is live to roll back from' };
  }

  const healthy = history
    .filter((d) => d.deploymentId !== live.deploymentId && d.wentLive && d.buildHash !== live.buildHash)
    .sort((a, b) => b.version - a.version)[0];

  if (!healthy) {
    return {
      ok: false,
      code: 'no_healthy_predecessor',
      message: 'no earlier deployment was ever live, so no previous fingerprint is proven healthy',
    };
  }

  return {
    ok: true,
    version: latestVersion + 1,
    target: {
      deploymentId: healthy.deploymentId,
      version: healthy.version,
      buildHash: healthy.buildHash,
    },
    supersedes: live.deploymentId,
  };
}

function short(hash: string): string {
  return hash.slice(0, 12);
}

// ---------- sites that must stay served ----------

/**
 * A site that is currently live and must survive the next publish.
 *
 * `renderedHash` and `html` come from re-rendering its stored descriptor now;
 * `recordedBuildHash` is what its deployment row says was approved.
 */
export interface LiveSibling {
  siteId: string;
  slug: string;
  recordedBuildHash: string;
  renderedHash: string | null;
  html: string | null;
}

export type SiblingRefusalCode = 'sibling_build_drifted' | 'sibling_unrenderable';

export interface SiblingRefusal {
  ok: false;
  code: SiblingRefusalCode;
  message: string;
  /** Slugs that could not be reproduced. */
  sites: string[];
}

export interface SiblingPlan {
  ok: true;
  sites: Array<{ slug: string; html: string }>;
}

/**
 * Decide which already-live sites go into the next deployment.
 *
 * Providers that deploy a whole-site snapshot replace everything each time, so
 * every live site has to be re-sent with each publish or it goes dark. The
 * bytes are re-derived by rendering each stored descriptor, which is safe only
 * because rendering is deterministic — the re-render must reproduce the hash
 * that deployment recorded.
 *
 * When one does not, the publish is refused rather than proceeding. The two
 * alternatives are worse: dropping that site takes a paying customer offline,
 * and shipping the new bytes publishes something nobody approved. A refusal
 * blocks until someone looks, which is the point.
 */
export function planSiblings(siblings: readonly LiveSibling[]): SiblingPlan | SiblingRefusal {
  const unrenderable = siblings.filter((s) => s.html === null || s.renderedHash === null);
  if (unrenderable.length > 0) {
    return {
      ok: false,
      code: 'sibling_unrenderable',
      message: `these live sites no longer render, so they cannot be kept served: ${unrenderable.map((s) => s.slug).join(', ')}`,
      sites: unrenderable.map((s) => s.slug),
    };
  }

  const drifted = siblings.filter((s) => s.renderedHash !== s.recordedBuildHash);
  if (drifted.length > 0) {
    return {
      ok: false,
      code: 'sibling_build_drifted',
      message: `these live sites no longer reproduce the build that was approved for them, so republishing would serve bytes nobody approved: ${drifted.map((s) => s.slug).join(', ')}`,
      sites: drifted.map((s) => s.slug),
    };
  }

  return {
    ok: true,
    sites: siblings.map((s) => ({ slug: s.slug, html: s.html as string })),
  };
}
