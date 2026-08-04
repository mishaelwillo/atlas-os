/**
 * Capability execution pipeline — the ONLY way a route runs (codegen contract,
 * registry.ts footer):
 *   auth → scope check → set_config('request.space_id') → input validation
 *   → audit_log INSERT → (approval gate | handler dispatch) → output validation
 * requiresApproval capabilities insert an approvals row and return
 * {approvalId, status:'review'} — they DO NOT execute (SECURITY.md inv. 1/4).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AtlasRouter } from '@atlas/router';
import { AuthError, authenticate, checkScopes, type AuthContext } from './auth.js';
import type { BuildInfo } from './build-info.js';
import type { HostingAdapter } from './factory/hosting.js';
import type { Db, Queryable } from './db.js';
import { checkOutreachPolicy } from './policy.js';
import type { Descriptor } from './factory/dossier.js';
import { qaForDescriptor } from './factory/qa.js';
import { readActivationFacts } from './revenue/activation-read.js';
import { planHostingTransition } from './revenue/hosting-activation.js';
import type { Env } from './env.js';
import { validateAgainstSchema } from './validate.js';

export interface CapabilityRouteMeta {
  id: string;
  name: string;
  path: string;
  method: 'GET' | 'POST';
  taskClass: 'think' | 'do' | 'quick';
  requiresApproval: boolean;
  scopes: readonly string[];
  input: object;
  output: object;
  /** Whether a run invokes this capability's handler or the model router. */
  execution: 'handler' | 'model';
}

export interface HandlerCtx {
  q: Queryable;
  auth: AuthContext;
  /** Space the request is scoped to (null only for operator without a pinned space). */
  spaceId: string | null;
  deps: PipelineDeps;
}

export type CapabilityHandler = (ctx: HandlerCtx, input: Record<string, unknown>) => Promise<Record<string, unknown>>;

/** Executes a previously-held action once the operator approves it. */
export type ApprovalDispatcher = (ctx: HandlerCtx, payload: Record<string, unknown>) => Promise<Record<string, unknown>>;

/** Handlers throw this for typed client-visible failures (400/404/409/501…). */
export class CapabilityError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export interface PipelineDeps {
  db: Db;
  env: Env;
  /** This deployment's fingerprint, so status can compare it against reality. */
  buildInfo: BuildInfo;
  /** Where published sites land; refuses when no provider is configured. */
  hosting: HostingAdapter;
  /**
   * Reads a published address back so the recorded fingerprint is measured
   * rather than assumed. Injected so tests never touch the network.
   */
  readPublic: (url: string) => Promise<{ status: number; body: string }>;
  /**
   * How persistently a published address is re-read before a non-match is
   * believed. Injected so tests do not sleep through real propagation waits.
   */
  readBack: { attempts: number; delayMs: number };
  router: AtlasRouter;
  /** registry meta keyed by capability id — runs.execute routes through this */
  capabilities: Record<string, CapabilityRouteMeta>;
  handlers: Record<string, CapabilityHandler>;
  dispatchers: Record<string, ApprovalDispatcher>;
  log: { info: (obj: unknown, msg?: string) => void; warn: (obj: unknown, msg?: string) => void; error: (obj: unknown, msg?: string) => void };
}

/** A pre-approval gate's verdict; `detail` is recorded on the refusal audit. */
interface PreApprovalRefusal {
  code: string;
  message: string;
  detail?: Record<string, unknown>;
}

/**
 * factory.deploy_site — the required QA checks decide before the approval row
 * exists.
 *
 * A build that fails accessibility, responsive, link, structured-data,
 * privacy, security or performance must not reach the queue at all. Queuing it
 * would invite an operator to approve something that cannot be published, and
 * make the approval the place quality is decided rather than where the
 * external effect is confirmed. The dispatcher checks again at publish time,
 * because the descriptor can change in between.
 */
async function checkDeployQa(
  q: Queryable,
  input: Record<string, unknown>,
): Promise<PreApprovalRefusal | null> {
  const siteId = typeof input.siteId === 'string' ? input.siteId.trim() : '';
  if (siteId === '') return null; // the dispatcher reports the missing id

  const res = await q.query(`select descriptor from sites where site_id = $1`, [siteId]);
  const row = res.rows[0];
  // An unknown site is not a QA failure; the dispatcher reports it as missing.
  if (!row) return null;

  const { report, failures } = qaForDescriptor(row.descriptor as Descriptor);
  // A descriptor that will not render has no build to judge; planPublish
  // refuses it on the render issues instead.
  if (report === null || failures.length === 0) return null;

  return {
    code: 'qa_failed',
    message: `the build fails required QA checks: ${failures.join(', ')}`,
    detail: { qaFailures: failures },
  };
}

/**
 * hosting.activate — the activation gate decides before the approval exists.
 *
 * "Hosting cannot activate before approved terms and confirmed payment" is the
 * acceptance, so an activation that cannot pass must not reach the queue: an
 * operator should never be shown an approval the dispatcher will refuse. The
 * dispatcher checks again, because the deal or the offer can change in between
 * and the approval says nothing about either.
 */
async function checkHostingActivation(
  q: Queryable,
  input: Record<string, unknown>,
): Promise<PreApprovalRefusal | null> {
  const leadId = typeof input.leadId === 'string' ? input.leadId.trim() : '';
  if (leadId === '') return null; // the dispatcher reports the missing id

  let facts;
  try {
    facts = await readActivationFacts(q, leadId);
  } catch (err) {
    // Migration 0006 has not been applied; the dispatcher reports that.
    if (typeof err === 'object' && err !== null && (err as { code?: unknown }).code === '42P01') {
      return null;
    }
    throw err;
  }
  // No entitlement at all is the dispatcher's story to tell, not a gate refusal.
  if ('note' in facts) return null;

  const plan = planHostingTransition({
    from: facts.state,
    to: 'entitlement_active',
    dealState: facts.dealState,
    acceptedOfferVersion: facts.acceptedOfferVersion,
    entitlementOfferVersion: facts.entitlementOfferVersion,
    disclosuresComplete: facts.disclosuresComplete,
    paymentReference: facts.paymentReference,
  });
  if (plan.ok) return null;

  return { code: plan.code, message: plan.message, detail: { from: facts.state } };
}

/**
 * Capability-specific policy gates evaluated before an approval is created.
 * Returns null when the request may proceed.
 */
async function checkPreApprovalPolicy(
  q: Queryable,
  capabilityId: string,
  spaceId: string | null,
  input: Record<string, unknown>,
  deps: PipelineDeps,
): Promise<PreApprovalRefusal | null> {
  if (capabilityId === 'factory.deploy_site') return checkDeployQa(q, input);
  if (capabilityId === 'hosting.activate') return checkHostingActivation(q, input);
  if (capabilityId !== 'outreach.send') return null;

  const leadId = typeof input.leadId === 'string' ? input.leadId.trim() : '';
  // Only a uuid can match a lead row; a hand-entered reference cannot, and is
  // handled as an unknown lead rather than a lookup error.
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(leadId);

  let leadStatus: string | null = null;
  if (isUuid) {
    const lead = await q.query(`select status from leads where lead_id = $1`, [leadId]);
    const row = lead.rows[0];
    if (row && typeof row.status === 'string') leadStatus = row.status;
  }

  /*
   * A pending draft counts toward the cap. Otherwise the queue could be filled
   * with touches that all become sendable the moment they are approved.
   * Rejected drafts do not count: refusing one should not consume the budget.
   */
  const counted = await q.query(
    `select count(*)::int as n from approvals
      where kind = 'outreach.send'
        and status <> 'rejected'
        and created_at >= date_trunc('day', now())
        and ($1::uuid is null or space_id = $1::uuid)`,
    [spaceId],
  );
  const touchesToday = Number(counted.rows[0]?.n ?? 0);

  return checkOutreachPolicy({
    leadStatus,
    touchesToday,
    dailyCap: deps.env.outreachDailyCap,
  });
}

export async function insertAudit(
  q: Queryable,
  spaceId: string | null,
  actor: string,
  action: string,
  target: string | null,
  detail: Record<string, unknown>,
): Promise<void> {
  await q.query(
    'insert into audit_log (space_id, actor, action, target, detail) values ($1, $2, $3, $4, $5)',
    [spaceId, actor, action, target, JSON.stringify(detail)],
  );
}

/** Shared by routes and the scheduler worker: full gated execution of one capability. */
export async function executeCapability(
  meta: CapabilityRouteMeta,
  auth: AuthContext,
  input: Record<string, unknown>,
  deps: PipelineDeps,
): Promise<{ statusCode: number; body: Record<string, unknown> }> {
  checkScopes(auth, [...meta.scopes]);

  const issues = validateAgainstSchema(meta.input, input, { coerce: meta.method === 'GET' });
  if (issues.length > 0) {
    return { statusCode: 400, body: { error: 'invalid input', issues } };
  }

  const spaceId = auth.spaceId;
  if (meta.requiresApproval && spaceId === null) {
    return { statusCode: 400, body: { error: 'approval-gated capability requires a space (x-atlas-space)' } };
  }

  return deps.db.withSpace(spaceId, async (q) => {
    // Every privileged call is audited — INSERT-only table (SECURITY.md inv. 2).
    await insertAudit(q, spaceId, auth.actor, meta.id, null, {
      method: meta.method,
      requiresApproval: meta.requiresApproval,
      inputKeys: Object.keys(input),
    });

    if (meta.requiresApproval) {
      /*
       * Policy runs before the approval exists. A suppressed lead or an
       * exhausted cap must not reach the queue at all: putting it there would
       * invite an operator to approve what policy already forbids.
       */
      const refusal = await checkPreApprovalPolicy(q, meta.id, spaceId, input, deps);
      if (refusal) {
        await insertAudit(q, spaceId, auth.actor, `${meta.id}.refused`, null, {
          code: refusal.code,
          ...(refusal.detail ?? {}),
        });
        return {
          statusCode: 409,
          body: { error: refusal.message, code: refusal.code, ...(refusal.detail ?? {}) },
        };
      }

      const res = await q.query(
        `insert into approvals (space_id, kind, reason, payload, status)
         values ($1, $2, $3, $4, 'pending')
         returning approval_id`,
        [spaceId, meta.id, `${meta.name} requested by ${auth.actor}`, JSON.stringify({ capability: meta.id, input })],
      );
      const approvalId = String(res.rows[0].approval_id);
      return { statusCode: 200, body: { approvalId, status: 'review' } };
    }

    const handler = deps.handlers[meta.id];
    if (!handler) return { statusCode: 501, body: { error: `no handler for ${meta.id}` } };

    let output: Record<string, unknown>;
    try {
      output = await handler({ q, auth, spaceId, deps }, input);
    } catch (err) {
      if (err instanceof CapabilityError) return { statusCode: err.statusCode, body: { error: err.message } };
      throw err;
    }

    const outIssues = validateAgainstSchema(meta.output, output);
    if (outIssues.length > 0) {
      deps.log.error({ capability: meta.id, outIssues }, 'output failed schema validation');
      return { statusCode: 500, body: { error: 'handler output failed validation', issues: outIssues } };
    }
    return { statusCode: 200, body: output };
  });
}

export function registerCapabilityRoute(app: FastifyInstance, meta: CapabilityRouteMeta, deps: PipelineDeps): void {
  app.route({
    method: meta.method,
    url: meta.path,
    handler: async (req: FastifyRequest, reply: FastifyReply) => {
      let auth: AuthContext;
      try {
        auth = await authenticate(
          req.headers.authorization,
          typeof req.headers['x-atlas-space'] === 'string' ? req.headers['x-atlas-space'] : undefined,
          deps,
        );
      } catch (err) {
        if (err instanceof AuthError) return reply.status(err.statusCode).send({ error: err.message });
        throw err;
      }

      const input =
        meta.method === 'GET'
          ? ((req.query ?? {}) as Record<string, unknown>)
          : ((req.body ?? {}) as Record<string, unknown>);

      try {
        const result = await executeCapability(meta, auth, input, deps);
        return await reply.status(result.statusCode).send(result.body);
      } catch (err) {
        if (err instanceof AuthError) return reply.status(err.statusCode).send({ error: err.message });
        deps.log.error({ capability: meta.id, err: err instanceof Error ? err.message : String(err) }, 'capability failed');
        return reply.status(500).send({ error: 'internal error' });
      }
    },
  });
}
