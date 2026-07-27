/**
 * Approval dispatchers — the ONLY place a held (requiresApproval) action
 * executes, and only from approvals.decide after an operator approves
 * (SECURITY.md inv. 1/3/4). Keyed by approvals.kind (= capability id).
 */
import { insertAudit, type ApprovalDispatcher } from './pipeline.js';

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

/** factory.deploy_site — stub: mark intent only; real deploy lands in P2. */
const factoryDeploySite: ApprovalDispatcher = async (ctx, payload) => {
  const input = (payload.input ?? {}) as Record<string, unknown>;
  ctx.deps.log.info({ siteId: input.siteId, domain: input.domain }, 'DEPLOY DISPATCH (stub) — no deploy performed');
  return { executed: true, stub: true, note: 'deploy adapter lands in P2' };
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
