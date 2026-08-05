/**
 * factory.verify_live (docs/specs/p2/website-factory.md).
 *
 * Walks every live deployment and compares what its address serves against the
 * build approved for it. The post-publish read-back proves the deployment being
 * made; nothing proved the ones made before it, and a published site once sat
 * answering 404 for an hour while its row read `live`.
 *
 * It changes no deployment state. A site that has gone wrong is still the site
 * that is public, and marking it otherwise would move the record further from
 * reality. It records what it observed and names what is wrong.
 */
import { insertAudit, type CapabilityHandler } from '../pipeline.js';
import {
  classifyLive,
  classifyWithdrawn,
  summariseSweep,
  summariseWithdrawn,
  type LiveDeploymentRef,
  type SweepEntry,
  type WithdrawnDeploymentRef,
  type WithdrawnEntry,
  type WithdrawnSummary,
} from '../factory/sweep.js';

export const verifyLiveSites: CapabilityHandler = async (ctx) => {
  const live = await ctx.q.query(
    `select deployment_id, site_id, domain, build_hash
       from site_deployments
      where status = 'live' and environment = 'production'
        and ($1::uuid is null or space_id = $1::uuid)
      order by created_at`,
    [ctx.spaceId],
  );

  const deployments: LiveDeploymentRef[] = live.rows.map((r) => ({
    deploymentId: String(r.deployment_id),
    siteId: String(r.site_id),
    domain: r.domain === null ? null : String(r.domain),
    buildHash: String(r.build_hash),
  }));

  const entries: SweepEntry[] = [];
  for (const deployment of deployments) {
    if (deployment.domain === null) {
      entries.push(classifyLive(deployment, null));
      continue;
    }
    try {
      const read = await ctx.deps.readPublic(deployment.domain);
      entries.push(classifyLive(deployment, read));
    } catch (err) {
      entries.push(
        classifyLive(deployment, null, err instanceof Error ? err.message : String(err)),
      );
    }
  }

  /*
   * Record every observation, including the ones that came back clean: a
   * fingerprint checked ten minutes ago and a fingerprint checked in March are
   * different kinds of evidence, and only the timestamp tells them apart.
   */
  for (const entry of entries) {
    if (entry.verdict === 'no_address') continue;
    await ctx.q.query(
      `update site_deployments
          set public_fingerprint = $2::text,
              fingerprint_checked_at = now(),
              fingerprint_matches = $3::boolean
        where deployment_id = $1`,
      [entry.deploymentId, entry.observed, entry.verdict === 'match'],
    );
  }

  const summary = summariseSweep(entries);

  // Only the failures are audited. A clean sweep every hour would bury the
  // audit trail under evidence that nothing happened.
  for (const entry of [...summary.mismatched, ...summary.unreadable]) {
    await insertAudit(ctx.q, ctx.spaceId, ctx.auth.actor, 'factory.live_site_drifted', entry.deploymentId, {
      siteId: entry.siteId,
      domain: entry.domain,
      verdict: entry.verdict,
      approved: entry.approved,
      observed: entry.observed,
    });
  }

  const withdrawn = await recheckWithdrawn(ctx);

  return {
    checked: summary.checked,
    matching: summary.matching,
    healthy: summary.healthy && withdrawn.unconfirmed.length === 0,
    mismatched: summary.mismatched,
    unreadable: summary.unreadable,
    withdrawalsChecked: withdrawn.checked,
    withdrawalsConfirmed: withdrawn.confirmed,
    withdrawalsUnconfirmed: withdrawn.unconfirmed,
    status: summary.healthy && withdrawn.unconfirmed.length === 0 ? 'ok' : 'drifted',
  };
};

/**
 * Re-check withdrawals that have not been observed to stop serving.
 *
 * The dispatcher checks once, at withdrawal time. A withdrawal that never
 * propagated would otherwise never be looked at again — and nothing else could
 * see it, because the live sweep above only walks deployments that are still
 * `live`.
 *
 * Only the unconfirmed are re-read. A withdrawal already observed gone cannot
 * un-go, so re-reading every withdrawal Atlas has ever made would spend
 * requests on settled history to learn nothing. The partial index migration
 * 0011 adds is exactly this predicate.
 */
async function recheckWithdrawn(
  ctx: Parameters<CapabilityHandler>[0],
): Promise<WithdrawnSummary> {
  const rows = await ctx.q.query(
    `select deployment_id, site_id, domain, build_hash
       from site_deployments
      where status = 'unpublished' and environment = 'production'
        and withdrawal_verdict is distinct from 'withdrawn'
        and ($1::uuid is null or space_id = $1::uuid)
      order by superseded_at desc
      limit 50`,
    [ctx.spaceId],
  );

  const entries: WithdrawnEntry[] = [];
  for (const r of rows.rows) {
    const deployment: WithdrawnDeploymentRef = {
      deploymentId: String(r.deployment_id),
      siteId: String(r.site_id),
      domain: r.domain === null ? null : String(r.domain),
      buildHash: String(r.build_hash),
    };
    if (deployment.domain === null) {
      entries.push(classifyWithdrawn(deployment, null));
      continue;
    }
    try {
      const read = await ctx.deps.readPublic(deployment.domain);
      entries.push(classifyWithdrawn(deployment, read));
    } catch (err) {
      entries.push(
        classifyWithdrawn(deployment, null, err instanceof Error ? err.message : String(err)),
      );
    }
  }

  /*
   * Record every verdict, including the ones still not confirmed: a withdrawal
   * checked ten minutes ago and one checked in March are different kinds of
   * evidence. `no_address` is skipped because there is no observation to
   * record — the schema would take the verdict, but it is not one of the four
   * the column is allowed to hold, and inventing a fifth to describe a missing
   * address would put a value in the column that no read-back produced.
   */
  for (const entry of entries) {
    if (entry.verdict === 'no_address') continue;
    await ctx.q.query(
      `update site_deployments
          set withdrawal_verdict = $2::text, withdrawal_checked_at = now()
        where deployment_id = $1`,
      [entry.deploymentId, entry.verdict],
    );
  }

  const summary = summariseWithdrawn(entries);
  for (const entry of summary.unconfirmed) {
    await insertAudit(
      ctx.q,
      ctx.spaceId,
      ctx.auth.actor,
      'factory.withdrawal_unconfirmed',
      entry.deploymentId,
      { siteId: entry.siteId, domain: entry.domain, verdict: entry.verdict, observed: entry.observed },
    );
  }
  return summary;
}
