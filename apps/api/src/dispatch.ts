/**
 * Approval dispatchers — the ONLY place a held (requiresApproval) action
 * executes, and only from approvals.decide after an operator approves
 * (SECURITY.md inv. 1/3/4). Keyed by approvals.kind (= capability id).
 */
import { insertAudit, type ApprovalDispatcher } from './pipeline.js';
import type { Descriptor } from './factory/dossier.js';
import { renderSite } from './factory/render.js';
import { planPublish } from './factory/publish.js';
import { siteSlug } from './factory/hosting.js';

/**
 * outreach.send — LOG-ONLY sender stub (P1 acceptance: "dispatcher fires
 * (log-only sender stub)"). A real channel adapter lands in P2; even then the
 * outbound message row must carry approved_by (schema-enforced).
 */
const outreachSend: ApprovalDispatcher = async (ctx, payload) => {
  const input = (payload.input ?? {}) as Record<string, unknown>;
  ctx.deps.log.info(
    { leadId: input.leadId, channel: input.channel, bodyPreview: String(input.body ?? '').slice(0, 120) },
    'OUTREACH DISPATCH (log-only stub) — message NOT actually sent',
  );
  await insertAudit(ctx.q, ctx.spaceId, ctx.auth.actor, 'outreach.dispatched', String(input.leadId ?? ''), {
    channel: input.channel,
    stub: true,
  });
  return { executed: true, stub: true, note: 'log-only sender — no message left the system' };
};

/** memory.adjudicate — operator verdict applied to the conflicted node. */
const memoryAdjudicate: ApprovalDispatcher = async (ctx, payload) => {
  const input = (payload.input ?? {}) as Record<string, unknown>;
  const res = await ctx.q.query(
    `update memory_nodes set truth_status = $2, updated_at = now() where node_id = $1`,
    [input.nodeId, input.verdict],
  );
  return { executed: true, updated: res.rowCount ?? 0 };
};

/**
 * factory.deploy_site — promote exactly the approved build.
 *
 * The descriptor is re-rendered here rather than trusting a hash recorded
 * earlier. Rendering is deterministic, so a mismatch means the descriptor
 * changed between approval and publish, which is precisely the case where
 * publishing would put something live that nobody approved.
 *
 * The build is handed to the hosting adapter before anything is recorded, and
 * the row then states what actually happened: 'live' with its address when the
 * provider accepted it, 'queued' with the reason when it did not. A record
 * written before the outcome is known would make the history claim something
 * is public that may never have been.
 */
const factoryDeploySite: ApprovalDispatcher = async (ctx, payload) => {
  const input = (payload.input ?? {}) as Record<string, unknown>;
  const siteId = typeof input.siteId === 'string' ? input.siteId.trim() : '';
  if (siteId === '') {
    return { executed: false, note: 'factory.deploy_site: siteId is required' };
  }

  const found = await ctx.q.query(
    `select site_id, business_name, descriptor from sites where site_id = $1`,
    [siteId],
  );
  const row = found.rows[0];
  if (!row) return { executed: false, note: 'factory.deploy_site: site not found' };

  const render = renderSite(row.descriptor as Descriptor);
  const approvedBuildHash =
    typeof input.buildHash === 'string' && input.buildHash.trim() !== ''
      ? input.buildHash.trim()
      : render.rendered
        ? render.hash
        : '';

  const history = await ctx.q.query(
    `select deployment_id, version, build_hash, status
       from site_deployments where site_id = $1
      order by version desc limit 1`,
    [siteId],
  );
  const liveRow = await ctx.q.query(
    `select deployment_id, version, build_hash
       from site_deployments
      where site_id = $1 and status = 'live' and environment = 'production'
      limit 1`,
    [siteId],
  );
  const latestVersion = Number(history.rows[0]?.version ?? 0);
  const live = liveRow.rows[0]
    ? {
        deploymentId: String(liveRow.rows[0].deployment_id),
        version: Number(liveRow.rows[0].version),
        buildHash: String(liveRow.rows[0].build_hash),
      }
    : null;

  const plan = planPublish({
    approvedBuildHash,
    currentBuildHash: render.rendered ? render.hash : null,
    renderIssues: render.rendered ? [] : render.issues,
    latestVersion,
    live,
  });

  if (!plan.ok) {
    await insertAudit(ctx.q, ctx.spaceId, ctx.auth.actor, 'factory.deploy_refused', siteId, {
      code: plan.code,
    });
    return { executed: false, note: plan.message, code: plan.code };
  }

  /*
   * Attempt the publish first, then record the outcome. A failure is kept as a
   * queued row carrying the provider's reason rather than being discarded: the
   * operator approved this, so the attempt belongs in history either way.
   */
  const slug = siteSlug(String(row.business_name ?? ''), siteId);
  let published: { url: string; providerRef: string | null } | null = null;
  let publishError: string | null = null;
  try {
    published = await ctx.deps.hosting.publish({
      slug,
      html: render.rendered ? render.html : '',
      buildHash: plan.buildHash,
      version: plan.version,
    });
  } catch (err) {
    publishError = err instanceof Error ? err.message : String(err);
  }

  const status = published ? 'live' : 'queued';
  const inserted = await ctx.q.query(
    `insert into site_deployments
       (space_id, site_id, version, environment, domain, build_hash, renderer_sha, status, approved_by, went_live_at)
     values ($1, $2, $3, 'production', $4, $5, $6, $7, $8, case when $7 = 'live' then now() else null end)
     returning deployment_id`,
    [
      ctx.spaceId,
      siteId,
      plan.version,
      published?.url ?? null,
      plan.buildHash,
      ctx.deps.buildInfo.gitSha,
      status,
      ctx.auth.actor,
    ],
  );
  const deploymentId = String(inserted.rows[0]?.deployment_id ?? '');

  // Exactly one live production deployment per site is enforced by a partial
  // unique index, so the previous one must step down as this one arrives.
  if (published && plan.supersedes) {
    await ctx.q.query(
      `update site_deployments set status = 'superseded', superseded_at = now()
        where deployment_id = $1 and status = 'live'`,
      [plan.supersedes],
    );
  }

  await insertAudit(ctx.q, ctx.spaceId, ctx.auth.actor, `factory.deploy_${status}`, deploymentId, {
    siteId,
    version: plan.version,
    buildHash: plan.buildHash,
    provider: ctx.deps.hosting.name,
  });

  return {
    executed: true,
    deploymentId,
    version: plan.version,
    buildHash: plan.buildHash,
    supersedes: plan.supersedes,
    status,
    url: published?.url ?? null,
    providerRef: published?.providerRef ?? null,
    note: published
      ? `published to ${published.url}`
      : `build verified and recorded, but not serving: ${publishError ?? 'no hosting target is configured'}`,
  };
};

/** playbooks.author — stub: budgeted frontier session lands in P2. */
/**
 * Slug for the playbook series a task family belongs to. Versions of the same
 * family must collide on this value, which is what makes them a lineage
 * rather than unrelated rows.
 */
export function playbookSlug(taskFamily: string): string {
  return taskFamily
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * playbooks.author — persists an approved playbook as a new immutable version.
 *
 * The spec's budgeted frontier session is NOT run here: no model credential is
 * configured, so calling one would fail at runtime. Rather than write an empty
 * record and call it authored, this stores the operator's brief as the body and
 * refuses when there is nothing to store. Rows are only ever inserted; a later
 * version supersedes an earlier one by ordering, never by mutation.
 */
const playbooksAuthor: ApprovalDispatcher = async (ctx, payload) => {
  const input = (payload.input ?? {}) as Record<string, unknown>;
  const taskFamily = typeof input.taskFamily === 'string' ? input.taskFamily.trim() : '';
  const brief = typeof input.brief === 'string' ? input.brief.trim() : '';

  if (taskFamily === '') {
    return { executed: false, note: 'playbooks.author: taskFamily is required' };
  }
  const slug = playbookSlug(taskFamily);
  if (slug === '') {
    return { executed: false, note: 'playbooks.author: taskFamily has no usable slug' };
  }
  if (brief === '') {
    // Nothing was authored, so nothing is recorded. An empty playbook would
    // read as an approved deliverable that does not exist.
    return {
      executed: false,
      note: 'playbooks.author: no brief supplied and no frontier session is configured, so there is nothing to author',
    };
  }

  // Version selection and insert are one statement so two concurrent approvals
  // cannot both read the same max; the (space_id, slug, version) unique index
  // is the backstop if they somehow do.
  const res = await ctx.q.query(
    `insert into playbooks (space_id, slug, version, task_family, body, authored_by)
     select $1, $2, coalesce(max(version), 0) + 1, $3, $4, $5
       from playbooks
      where space_id is not distinct from $1 and slug = $2
     returning playbook_id, version`,
    [ctx.spaceId, slug, taskFamily, brief, ctx.auth.actor],
  );

  const row = res.rows[0];
  if (!row) {
    return { executed: false, note: 'playbooks.author: playbook was not persisted' };
  }

  const version = Number(row.version);
  await insertAudit(ctx.q, ctx.spaceId, ctx.auth.actor, 'playbooks.authored', String(row.playbook_id), {
    slug,
    version,
    taskFamily,
  });

  return {
    executed: true,
    playbookId: String(row.playbook_id),
    version,
    slug,
    supersedes: version > 1 ? version - 1 : null,
    frontierSession: false,
  };
};

export const dispatchers: Record<string, ApprovalDispatcher> = {
  'outreach.send': outreachSend,
  'memory.adjudicate': memoryAdjudicate,
  'factory.deploy_site': factoryDeploySite,
  'playbooks.author': playbooksAuthor,
};
