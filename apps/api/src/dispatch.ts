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
const playbooksAuthor: ApprovalDispatcher = async (ctx, payload) => {
  ctx.deps.log.info({ payload }, 'PLAYBOOK AUTHORING approved (stub) — session runner lands in P2');
  return { executed: false, stub: true, note: 'authoring session runner lands in P2' };
};

export const dispatchers: Record<string, ApprovalDispatcher> = {
  'outreach.send': outreachSend,
  'memory.adjudicate': memoryAdjudicate,
  'factory.deploy_site': factoryDeploySite,
  'playbooks.author': playbooksAuthor,
};
