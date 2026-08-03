/**
 * automation.sequence and sequence.advance handlers
 * (docs/specs/p2/revenue-pilot.md).
 *
 * A sequence plans state and records what happened. It cannot send, and it
 * cannot record a send: `scheduled → sent` is refused here and only the
 * approval-gated `outreach.send` dispatcher may make that move. That is the
 * specification's "plans state but cannot bypass per-touch checks" made
 * structural rather than asserted.
 *
 * These read and write `outreach_sequences` and `outreach_touches`, which
 * migration 0005 creates. Until it is applied they report `schema_pending` and
 * change nothing.
 */
import { CapabilityError, insertAudit, type CapabilityHandler } from '../pipeline.js';
import {
  MIN_TOUCH_SPACING_HOURS,
  nextEligibleTouch,
  planSequence,
  planTouchAdvance,
  sequenceStateFrom,
  type TouchRecord,
  type TouchState,
} from '../revenue/sequence.js';

/** Postgres `undefined_table`; the one error meaning migration 0005 has not run. */
const UNDEFINED_TABLE = '42P01';

const SCHEMA_PENDING = {
  status: 'schema_pending' as const,
  note: 'migration 0005_outreach_sequences has not been applied to this database, so nothing was read or written',
};

function isMissingTable(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === UNDEFINED_TABLE;
}

async function withSchema<T extends Record<string, unknown>>(
  run: () => Promise<T>,
): Promise<T | typeof SCHEMA_PENDING> {
  try {
    return await run();
  } catch (err) {
    if (isMissingTable(err)) return SCHEMA_PENDING;
    throw err;
  }
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function pending(outcome: Record<string, unknown>): boolean {
  return 'status' in outcome && outcome.status === 'schema_pending';
}

function touchRows(rows: readonly Record<string, unknown>[]): TouchRecord[] {
  return rows.map((r) => ({
    touchId: String(r.touch_id),
    step: Number(r.step),
    channel: String(r.channel),
    state: String(r.state) as TouchState,
    sentAt: r.sent_at ? new Date(String(r.sent_at)).toISOString() : null,
  }));
}

/**
 * automation.sequence — plan an ordered set of touches for one lead.
 *
 * Planning creates drafts and nothing else. No touch is scheduled, none is
 * approved, and none can be sent from here; each still has to pass its own
 * policy check and its own named approval. A plan is a statement of intent,
 * not permission.
 */
export const automationSequence: CapabilityHandler = async (ctx, input) => {
  const leadId = text(input.leadId);
  if (leadId === null) throw new CapabilityError(400, 'automation.sequence: leadId is required');
  if (ctx.spaceId === null) {
    throw new CapabilityError(400, 'automation.sequence requires a space (x-atlas-space)');
  }
  const channels = Array.isArray(input.channels)
    ? input.channels.filter((c): c is string => typeof c === 'string')
    : [];

  const lead = await ctx.q.query(`select lead_id, status from leads where lead_id = $1`, [leadId]);
  if (!lead.rows[0]) throw new CapabilityError(404, 'automation.sequence: lead not found');

  /*
   * A suppressed lead cannot be sequenced at all. Planning touches for someone
   * who asked us to stop would put the refusal at send time, one approval
   * screen away from a mistake, instead of here where it costs nothing.
   */
  if (String(lead.rows[0].status) === 'suppressed') {
    return {
      planned: false,
      code: 'lead_suppressed',
      note: 'this lead is suppressed; no sequence may be planned',
      status: 'refused',
    };
  }

  const outcome = await withSchema(async () => {
    const open = await ctx.q.query(
      `select sequence_id from outreach_sequences
        where lead_id = $1 and state in ('planned', 'active') limit 1`,
      [leadId],
    );

    const plan = planSequence({ channels, openSequence: open.rows.length > 0 });
    if (!plan.ok) {
      await insertAudit(ctx.q, ctx.spaceId, ctx.auth.actor, 'automation.sequence_refused', leadId, {
        code: plan.code,
      });
      return { planned: false, code: plan.code, note: plan.message, status: 'refused' };
    }

    const versionRow = await ctx.q.query(
      `select coalesce(max(version), 0) + 1 as next from outreach_sequences where lead_id = $1`,
      [leadId],
    );
    const version = Number(versionRow.rows[0]?.next ?? 1);

    const created = await ctx.q.query(
      `insert into outreach_sequences (space_id, lead_id, version, state, planned_by)
       values ($1, $2, $3, 'planned', $4)
       returning sequence_id`,
      [ctx.spaceId, leadId, version, ctx.auth.actor],
    );
    const sequenceId = String(created.rows[0]?.sequence_id ?? '');
    if (sequenceId === '') {
      throw new CapabilityError(500, 'automation.sequence: sequence was not persisted');
    }

    for (const step of plan.steps) {
      await ctx.q.query(
        `insert into outreach_touches (space_id, sequence_id, lead_id, step, channel, state)
         values ($1, $2, $3, $4, $5, 'draft')`,
        [ctx.spaceId, sequenceId, leadId, step.step, step.channel],
      );
    }

    await insertAudit(ctx.q, ctx.spaceId, ctx.auth.actor, 'automation.sequence_planned', sequenceId, {
      leadId,
      steps: plan.steps.length,
      channels: plan.steps.map((s) => s.channel),
    });

    return {
      planned: true,
      sequenceId,
      version,
      state: 'planned',
      steps: plan.steps,
      status: 'planned',
    };
  });

  return pending(outcome) ? { ...SCHEMA_PENDING, planned: false } : outcome;
};

/**
 * sequence.advance — record what happened to one touch.
 *
 * The current state is read from the row, never supplied, so a caller cannot
 * describe a touch as further along than it is and step from there. Reaching
 * `sent` is refused outright: recording a send that no dispatcher performed
 * would make the audit trail claim an external effect that never happened.
 */
export const sequenceAdvance: CapabilityHandler = async (ctx, input) => {
  const touchId = text(input.touchId);
  const to = text(input.state);
  if (touchId === null) throw new CapabilityError(400, 'sequence.advance: touchId is required');
  if (to === null) throw new CapabilityError(400, 'sequence.advance: state is required');
  const approvalId = text(input.approvalId);

  const outcome = await withSchema(async () => {
    const found = await ctx.q.query(
      `select t.touch_id, t.sequence_id, t.state, t.step, s.state as sequence_state
         from outreach_touches t
         join outreach_sequences s on s.sequence_id = t.sequence_id
        where t.touch_id = $1`,
      [touchId],
    );
    const row = found.rows[0];
    if (!row) throw new CapabilityError(404, 'sequence.advance: touch not found');

    /*
     * An approval reference must be a real approvals row that was actually
     * approved. Accepting any string would make the approval requirement a
     * formality a caller satisfies by typing something.
     */
    let verifiedApproval: string | null = null;
    if (approvalId !== null) {
      const appr = await ctx.q.query(
        `select approval_id from approvals where approval_id = $1 and status = 'approved'`,
        [approvalId],
      );
      verifiedApproval = appr.rows[0] ? String(appr.rows[0].approval_id) : null;
    }

    const plan = planTouchAdvance({
      sequenceState: String(row.sequence_state),
      from: String(row.state),
      to,
      approvalId: verifiedApproval,
    });

    if (!plan.ok) {
      await insertAudit(ctx.q, ctx.spaceId, ctx.auth.actor, 'sequence.advance_refused', touchId, {
        code: plan.code,
        from: String(row.state),
        to,
      });
      return { advanced: false, code: plan.code, note: plan.message, status: 'refused' };
    }

    await ctx.q.query(
      `update outreach_touches
          set state = $2, approval_id = coalesce($3, approval_id), updated_at = now()
        where touch_id = $1`,
      [touchId, plan.to, verifiedApproval],
    );

    const sequenceId = String(row.sequence_id);
    const after = await ctx.q.query(
      `select touch_id, step, channel, state, sent_at from outreach_touches
        where sequence_id = $1 order by step`,
      [sequenceId],
    );
    const touches = touchRows(after.rows);
    const sequenceState = sequenceStateFrom(touches);

    await ctx.q.query(
      `update outreach_sequences
          set state = $2,
              stopped_reason = case when $2 = 'stopped' then $3 else stopped_reason end,
              updated_at = now()
        where sequence_id = $1`,
      [sequenceId, sequenceState, plan.stopsSequence ? plan.to : null],
    );

    await insertAudit(ctx.q, ctx.spaceId, ctx.auth.actor, 'sequence.advanced', touchId, {
      from: plan.from,
      to: plan.to,
      sequenceState,
    });

    return {
      advanced: true,
      touchId,
      from: plan.from,
      to: plan.to,
      sequenceState,
      stopped: plan.stopsSequence,
      status: plan.to,
    };
  });

  return pending(outcome) ? { ...SCHEMA_PENDING, advanced: false } : outcome;
};

/**
 * sequence.state — the plan, what happened to it, and what is eligible next.
 *
 * Read-only. `next` is computed rather than stored so it cannot go stale, and
 * it says why nothing is eligible when nothing is, which is usually the
 * question an operator actually has.
 */
export const sequenceState: CapabilityHandler = async (ctx, input) => {
  const leadId = text(input.leadId);
  if (leadId === null) throw new CapabilityError(400, 'sequence.state: leadId is required');

  const outcome = await withSchema(async () => {
    const seq = await ctx.q.query(
      `select sequence_id, version, state, stopped_reason
         from outreach_sequences where lead_id = $1
        order by version desc limit 1`,
      [leadId],
    );
    const row = seq.rows[0];
    if (!row) return { found: false, status: 'no_sequence' };

    const sequenceId = String(row.sequence_id);
    const rows = await ctx.q.query(
      `select touch_id, step, channel, state, sent_at from outreach_touches
        where sequence_id = $1 order by step`,
      [sequenceId],
    );
    const touches = touchRows(rows.rows);
    const next = nextEligibleTouch({
      sequenceState: String(row.state),
      touches,
      now: new Date(),
      spacingHours: MIN_TOUCH_SPACING_HOURS,
    });

    return {
      found: true,
      sequenceId,
      version: Number(row.version),
      state: String(row.state),
      stoppedReason: row.stopped_reason ? String(row.stopped_reason) : null,
      touches,
      next: next.ok
        ? { eligible: true, touchId: next.touchId, step: next.step, channel: next.channel }
        : { eligible: false, code: next.code, note: next.message },
      status: 'ok',
    };
  });

  return pending(outcome) ? { ...SCHEMA_PENDING, found: false } : outcome;
};
