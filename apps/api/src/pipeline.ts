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
import type { Db, Queryable } from './db.js';
import type { Env } from './env.js';
import { validateAgainstSchema, type SchemaNode } from './validate.js';

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
  router: AtlasRouter;
  /** registry meta keyed by capability id — runs.execute routes through this */
  capabilities: Record<string, CapabilityRouteMeta>;
  handlers: Record<string, CapabilityHandler>;
  dispatchers: Record<string, ApprovalDispatcher>;
  log: { info: (obj: unknown, msg?: string) => void; warn: (obj: unknown, msg?: string) => void; error: (obj: unknown, msg?: string) => void };
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

  const issues = validateAgainstSchema(meta.input as SchemaNode, input, { coerce: meta.method === 'GET' });
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

    const outIssues = validateAgainstSchema(meta.output as SchemaNode, output);
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
