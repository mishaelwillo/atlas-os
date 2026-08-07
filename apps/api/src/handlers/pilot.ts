/**
 * pilot.record_cost and pilot.record_outcome
 * (docs/specs/p2/revenue-pilot.md).
 *
 * P2C's exit criterion is "one paying customer AND complete cost/support/
 * outcome record". These write the second half. The rules they enforce live in
 * revenue/pilot-record.ts and are tested there; this module does the reading,
 * the writing and the auditing.
 *
 * Both write tables migration 0012 creates. Until it is applied they report
 * `schema_pending` and change nothing — a 500 would be indistinguishable from
 * a real fault, and a fabricated success worse than either.
 */
import { CapabilityError, insertAudit, type CapabilityHandler } from '../pipeline.js';
import { planCostEntry, planOutcome } from '../revenue/pilot-record.js';

/** Postgres `undefined_table`; the one error meaning migration 0012 has not run. */
const UNDEFINED_TABLE = '42P01';

const SCHEMA_PENDING = {
  status: 'schema_pending' as const,
  note: 'migration 0012_pilot_cost_and_outcome has not been applied to this database, so nothing was recorded',
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

function pending(value: Record<string, unknown>): boolean {
  return value.status === 'schema_pending';
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** A date the operator supplied, refused rather than defaulted to today. */
function isoDate(value: unknown): string | null {
  const raw = text(value);
  if (raw === null) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) && Number.isFinite(Date.parse(raw)) ? raw : null;
}

/**
 * pilot.record_cost — one cost the pilot incurred.
 *
 * `leadId` is optional on purpose. A monthly provider bill is a real pilot cost
 * that belongs to no single customer, and splitting it across customers would
 * invent an allocation nobody decided. Unattributed costs count toward the
 * pilot total and are excluded from per-customer cost.
 */
export const pilotRecordCost: CapabilityHandler = async (ctx, input) => {
  if (ctx.spaceId === null) {
    throw new CapabilityError(400, 'pilot.record_cost requires a space (x-atlas-space)');
  }
  const incurredOn = isoDate(input.incurredOn);
  if (incurredOn === null) {
    throw new CapabilityError(400, 'pilot.record_cost: incurredOn is required as YYYY-MM-DD');
  }
  const leadId = text(input.leadId);

  const plan = planCostEntry({
    category: text(input.category) ?? '',
    amountMinor: count(input.amountMinor),
    currency: text(input.currency),
    minutes: count(input.minutes),
    note: text(input.note),
  });

  const outcome = await withSchema(async () => {
    if (leadId !== null) {
      const lead = await ctx.q.query(`select lead_id from leads where lead_id = $1`, [leadId]);
      if (!lead.rows[0]) throw new CapabilityError(404, 'pilot.record_cost: lead not found');
    }
    if (!plan.ok) {
      await insertAudit(ctx.q, ctx.spaceId, ctx.auth.actor, 'pilot.record_cost_refused', leadId, {
        code: plan.code,
      });
      return { recorded: false, code: plan.code, note: plan.message, status: 'refused' };
    }

    const res = await ctx.q.query(
      `insert into pilot_cost_entries
         (space_id, lead_id, category, amount_minor, currency, minutes, incurred_on, note, recorded_by)
       values ($1, $2::uuid, $3, $4, $5, $6, $7::date, $8, $9)
       returning entry_id`,
      [
        ctx.spaceId,
        leadId,
        plan.category,
        plan.amountMinor,
        plan.currency,
        plan.minutes,
        incurredOn,
        plan.note,
        ctx.auth.actor,
      ],
    );
    const entryId = String(res.rows[0]?.entry_id ?? '');
    if (entryId === '') throw new CapabilityError(500, 'pilot.record_cost: entry was not persisted');

    /*
     * The figure itself is audited. A cost record whose trail omits the number
     * cannot be reconciled against the table later, and reconciling it is the
     * whole reason the record exists.
     */
    await insertAudit(ctx.q, ctx.spaceId, ctx.auth.actor, 'pilot.cost_recorded', entryId, {
      category: plan.category,
      leadId,
      amountMinor: plan.amountMinor,
      currency: plan.currency,
      minutes: plan.minutes,
    });

    return { recorded: true, entryId, category: plan.category, status: 'recorded' };
  });

  return pending(outcome) ? { ...SCHEMA_PENDING, recorded: false } : outcome;
};

/**
 * pilot.record_outcome — an observed satisfaction score for one customer.
 *
 * Requires a lead: satisfaction is a fact about a customer, and an
 * unattributed score would tell nobody whose experience it describes.
 */
export const pilotRecordOutcome: CapabilityHandler = async (ctx, input) => {
  if (ctx.spaceId === null) {
    throw new CapabilityError(400, 'pilot.record_outcome requires a space (x-atlas-space)');
  }
  const leadId = text(input.leadId);
  if (leadId === null) throw new CapabilityError(400, 'pilot.record_outcome: leadId is required');
  const observedOn = isoDate(input.observedOn);
  if (observedOn === null) {
    throw new CapabilityError(400, 'pilot.record_outcome: observedOn is required as YYYY-MM-DD');
  }

  const plan = planOutcome({
    satisfaction: count(input.satisfaction) ?? Number.NaN,
    note: text(input.note),
  });

  const outcome = await withSchema(async () => {
    const lead = await ctx.q.query(`select lead_id from leads where lead_id = $1`, [leadId]);
    if (!lead.rows[0]) throw new CapabilityError(404, 'pilot.record_outcome: lead not found');

    if (!plan.ok) {
      await insertAudit(ctx.q, ctx.spaceId, ctx.auth.actor, 'pilot.record_outcome_refused', leadId, {
        code: plan.code,
      });
      return { recorded: false, code: plan.code, note: plan.message, status: 'refused' };
    }

    const res = await ctx.q.query(
      `insert into pilot_outcomes (space_id, lead_id, satisfaction, observed_on, note, recorded_by)
       values ($1, $2::uuid, $3, $4::date, $5, $6)
       returning outcome_id`,
      [ctx.spaceId, leadId, plan.satisfaction, observedOn, plan.note, ctx.auth.actor],
    );
    const outcomeId = String(res.rows[0]?.outcome_id ?? '');
    if (outcomeId === '') {
      throw new CapabilityError(500, 'pilot.record_outcome: outcome was not persisted');
    }

    await insertAudit(ctx.q, ctx.spaceId, ctx.auth.actor, 'pilot.outcome_recorded', outcomeId, {
      leadId,
      satisfaction: plan.satisfaction,
    });

    return { recorded: true, outcomeId, satisfaction: plan.satisfaction, status: 'recorded' };
  });

  return pending(outcome) ? { ...SCHEMA_PENDING, recorded: false } : outcome;
};
