/**
 * approvals.list / approvals.decide.
 * decide is OPERATOR-ONLY (enforced here as the route guard, and again by RLS:
 * tokens have no UPDATE policy on approvals — SECURITY.md inv. 3).
 * On approve, the held action fires via the dispatcher map (dispatch.ts).
 */
import { CapabilityError, insertAudit, type CapabilityHandler } from '../pipeline.js';

export const approvalsList: CapabilityHandler = async (ctx) => {
  const res = await ctx.q.query(
    `select approval_id, space_id, run_id, kind, reason, payload, status, created_at
       from approvals
      where status = 'pending'
        and ($1::uuid is null or space_id = $1::uuid)
      order by created_at asc
      limit 100`,
    [ctx.spaceId],
  );
  return {
    approvals: res.rows.map((r) => ({
      approvalId: String(r.approval_id),
      spaceId: r.space_id === null ? null : String(r.space_id),
      runId: r.run_id === null ? null : String(r.run_id),
      kind: String(r.kind),
      reason: String(r.reason),
      payload: r.payload,
      createdAt: String(r.created_at),
    })),
  };
};

export const approvalsDecide: CapabilityHandler = async (ctx, input) => {
  if (ctx.auth.kind !== 'operator') {
    throw new CapabilityError(403, 'approvals.decide is operator-only');
  }
  const approvalId = input.approvalId as string;
  const decision = input.decision as 'approved' | 'rejected';
  const notes = typeof input.notes === 'string' ? input.notes : null;

  const found = await ctx.q.query(
    `select approval_id, space_id, run_id, kind, payload from approvals where approval_id = $1 and status = 'pending'`,
    [approvalId],
  );
  const approval = found.rows[0];
  if (!approval) throw new CapabilityError(404, 'approval not found or already decided');

  await ctx.q.query(
    `update approvals set status = $2, decided_by = $3, decided_at = now(),
            payload = payload || jsonb_build_object('operatorNotes', $4::text)
      where approval_id = $1`,
    [approvalId, decision, ctx.auth.actor, notes],
  );

  await insertAudit(ctx.q, ctx.spaceId, ctx.auth.actor, 'approvals.decide', approvalId, {
    decision,
    kind: String(approval.kind),
    notes,
  });

  let dispatched: Record<string, unknown> | null = null;
  if (decision === 'approved') {
    const kind = String(approval.kind);
    const payload = (approval.payload ?? {}) as Record<string, unknown>;
    const dispatcher = ctx.deps.dispatchers[kind];
    if (dispatcher) {
      dispatched = await dispatcher(
        { ...ctx, spaceId: approval.space_id === null ? ctx.spaceId : String(approval.space_id) },
        payload,
      );
    } else {
      ctx.deps.log.warn({ kind, approvalId }, 'approved with no dispatcher registered — nothing executed');
      dispatched = { executed: false, note: `no dispatcher for kind '${kind}'` };
    }
    if (approval.run_id !== null) {
      await ctx.q.query(`update runs set status = 'queued' where run_id = $1 and status = 'review'`, [approval.run_id]);
    }
  } else if (approval.run_id !== null) {
    await ctx.q.query(
      `update runs set status = 'cancelled', finished_at = now() where run_id = $1 and status = 'review'`,
      [approval.run_id],
    );
  }

  return { ok: true, approvalId, decision, dispatched };
};
