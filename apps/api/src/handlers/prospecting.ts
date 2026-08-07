/**
 * prospecting.* and demos.* handlers (docs/specs/p2/revenue-pilot.md).
 *
 * These read and write `qualification_assessments` and `demo_queue`, which
 * migration 0004 creates. Until it is applied they report `schema_pending` and
 * change nothing — the same honesty the hosting adapter applies when no
 * provider is configured. A 500 would be indistinguishable from a real fault,
 * and pretending to succeed would be worse.
 */
import { CapabilityError, insertAudit, type CapabilityHandler, type HandlerCtx } from '../pipeline.js';
import {
  assessProspect,
  assessmentExpired,
  isContactPolicy,
  type ContactPolicy,
  type QualificationEvidence,
} from '../revenue/qualification.js';
import {
  DEMO_QUEUE_CAP,
  DEMO_QUEUE_FLOOR,
  demoExpiry,
  planAdvance,
  planEnqueue,
  type QueuedDemo,
} from '../revenue/demo-queue.js';

/** Postgres `undefined_table`; the one error that means "migration 0004 has not run". */
const UNDEFINED_TABLE = '42P01';

const SCHEMA_PENDING = {
  status: 'schema_pending' as const,
  note: 'migration 0004_prospect_qualification has not been applied to this database, so nothing was read or written',
};

function isMissingTable(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === UNDEFINED_TABLE;
}

/**
 * Run a query set, or report that the schema is not there yet.
 *
 * Every write in these handlers is wrapped as a whole rather than per
 * statement, so a partially-applied schema cannot leave half an operation
 * committed and still be reported as pending.
 */
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

function bool(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/**
 * Read the rubric inputs off the request.
 *
 * Anything absent stays absent rather than defaulting: an unchecked field must
 * reach the rubric as unknown, because the rubric's whole job is to tell an
 * unanswered question apart from a settled fact.
 */
/**
 * The contact-policy outcome, accepting the boolean this field used to be.
 *
 * Assessments recorded before the three-state field carry
 * `contactPolicyReviewed: true`, which meant "reviewed, nothing stopping us" —
 * so it maps to `permitted`. Anything else maps to `unreviewed`, including the
 * legacy `false`, because back then `false` and absent were the same thing and
 * reading it as `prohibited` now would invent a finding nobody recorded.
 */
function readContactPolicy(raw: Record<string, unknown>): ContactPolicy {
  if (isContactPolicy(raw.contactPolicy)) return raw.contactPolicy;
  return raw.contactPolicyReviewed === true ? 'permitted' : 'unreviewed';
}

export function readEvidence(raw: Record<string, unknown>): QualificationEvidence {
  const status = text(raw.operatingStatus);
  return {
    region: text(raw.region) ?? '',
    vertical: text(raw.vertical) ?? '',
    targetRegions: stringList(raw.targetRegions),
    targetVerticals: stringList(raw.targetVerticals),
    activeProfile: bool(raw.activeProfile),
    websiteUrl: text(raw.websiteUrl),
    weakSiteProblem: text(raw.weakSiteProblem),
    identityVerified: bool(raw.identityVerified),
    locationVerified: bool(raw.locationVerified),
    publicFactCount: typeof raw.publicFactCount === 'number' ? raw.publicFactCount : 0,
    contactSource: text(raw.contactSource),
    contactPolicy: readContactPolicy(raw),
    // Suppression is a fact about the lead, resolved from the row rather than
    // taken from the request; the caller cannot assert its way past it.
    suppressed: false,
    duplicateOf: text(raw.duplicateOf),
    operatingStatus: status === 'open' || status === 'closed' ? status : 'uncertain',
    demoEffortHours: typeof raw.demoEffortHours === 'number' ? raw.demoEffortHours : 0,
    deceptiveDemoRisk: raw.deceptiveDemoRisk === true,
    benefitRationale: text(raw.benefitRationale),
  };
}

async function requireLead(ctx: HandlerCtx, leadId: string): Promise<{ status: string }> {
  const res = await ctx.q.query(`select lead_id, status from leads where lead_id = $1`, [leadId]);
  const row = res.rows[0];
  if (!row) {
    // RLS scopes this query, so "not in this space" and "does not exist" are
    // deliberately indistinguishable to the caller.
    throw new CapabilityError(404, 'lead not found');
  }
  return { status: String(row.status ?? '') };
}

/**
 * leads.record — record one prospect an operator sourced by hand.
 *
 * `leads.find` needs an approved directory adapter and does not have one, so
 * without this there is no way to get a prospect into the pilot at all: every
 * P2C surface keys off a lead, and nothing could create one. The specification
 * treats hand sourcing as the pilot workflow in the meantime.
 *
 * Three things it deliberately will not do.
 *
 * It will not admit a prospect with no provenance. `sourceUrl` is required
 * because the rubric's contact-source check is one an unsourced lead can never
 * pass — admitting one would only create a prospect that cannot be qualified.
 *
 * It will not set the outreach lifecycle. A new lead is `new`, full stop.
 * `leads.status` carries suppression, and letting a recorder choose it would
 * let a hand-typed row assert consent nobody gave.
 *
 * It will not create a second row for a business already in the space. The
 * specification says duplicates merge with provenance, and the rubric
 * disqualifies a duplicate outright; silently recording one twice would put
 * two prospects in the funnel for one business and let both be contacted.
 */
export const leadsRecord: CapabilityHandler = async (ctx, input) => {
  const businessName = text(input.businessName);
  const sourceUrl = text(input.sourceUrl);
  if (businessName === null) throw new CapabilityError(400, 'leads.record: businessName is required');
  if (sourceUrl === null) {
    throw new CapabilityError(400, 'leads.record: sourceUrl is required — where did you find this business?');
  }
  if (ctx.spaceId === null) {
    throw new CapabilityError(400, 'leads.record requires a space (x-atlas-space)');
  }

  const existing = await ctx.q.query(
    `select lead_id from leads where space_id = $1 and lower(business_name) = lower($2) limit 1`,
    [ctx.spaceId, businessName],
  );
  if (existing.rows[0]) {
    const duplicateOf = String(existing.rows[0].lead_id);
    await insertAudit(ctx.q, ctx.spaceId, ctx.auth.actor, 'leads.record_refused', duplicateOf, {
      code: 'already_recorded',
      businessName,
    });
    return {
      recorded: false,
      code: 'already_recorded',
      duplicateOf,
      note: 'this business is already recorded in this space; qualify or re-assess the existing prospect',
      status: 'refused',
    };
  }

  /*
   * Provenance goes in `criteria` because the leads table has no column for
   * it. That is a real limitation rather than a design: a dedicated column
   * would need a migration, and the jsonb keeps the fact attached to the row
   * that is going to be qualified against it.
   */
  const criteria = {
    sourceUrl,
    recordedBy: ctx.auth.actor,
    handSourced: true,
    ...(text(input.websiteUrl) === null ? {} : { websiteUrl: text(input.websiteUrl) }),
    ...(text(input.note) === null ? {} : { note: text(input.note) }),
  };

  const res = await ctx.q.query(
    `insert into leads (space_id, business_name, gbp_url, phone, criteria, score, status)
     values ($1, $2, $3, $4, $5::jsonb, 0, 'new')
     returning lead_id`,
    [ctx.spaceId, businessName, sourceUrl, text(input.phone), JSON.stringify(criteria)],
  );
  const leadId = String(res.rows[0]?.lead_id ?? '');
  if (leadId === '') throw new CapabilityError(500, 'leads.record: lead was not persisted');

  await insertAudit(ctx.q, ctx.spaceId, ctx.auth.actor, 'leads.recorded', leadId, {
    businessName,
    sourceUrl,
  });

  return { recorded: true, leadId, status: 'new' };
};

/**
 * prospecting.qualify — record an assessment against the pilot rubric.
 *
 * The verdict is derived from the supplied evidence rather than accepted from
 * the caller, so two operators looking at the same prospect cannot record
 * different totals, and a stored verdict can be recomputed from the evidence
 * beside it. Suppression is read from the lead row, not the request: a
 * suppressed prospect must not become qualifiable by omitting the field.
 */
export const prospectingQualify: CapabilityHandler = async (ctx, input) => {
  const leadId = text(input.leadId);
  if (leadId === null) throw new CapabilityError(400, 'prospecting.qualify: leadId is required');
  if (ctx.spaceId === null) {
    throw new CapabilityError(400, 'prospecting.qualify requires a space (x-atlas-space)');
  }
  const raw = typeof input.evidence === 'object' && input.evidence !== null
    ? (input.evidence as Record<string, unknown>)
    : {};

  const lead = await requireLead(ctx, leadId);
  const evidence: QualificationEvidence = {
    ...readEvidence(raw),
    suppressed: lead.status === 'suppressed',
  };

  const result = assessProspect(evidence, new Date());

  const outcome = await withSchema(async () => {
    const res = await ctx.q.query(
      `insert into qualification_assessments
         (space_id, lead_id, region, vertical, verdict, total, scores, blockers, unknowns, evidence, assessed_by, expires_at)
       values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb, $11, $12)
       returning assessment_id`,
      [
        ctx.spaceId,
        leadId,
        evidence.region,
        evidence.vertical,
        result.verdict,
        result.total,
        JSON.stringify(result.scores),
        JSON.stringify(result.blockers),
        JSON.stringify(result.unknowns),
        JSON.stringify(evidence),
        ctx.auth.actor,
        result.expiresAt,
      ],
    );
    const assessmentId = String(res.rows[0]?.assessment_id ?? '');
    if (assessmentId === '') {
      throw new CapabilityError(500, 'prospecting.qualify: assessment was not persisted');
    }
    await insertAudit(ctx.q, ctx.spaceId, ctx.auth.actor, 'prospecting.qualified', leadId, {
      verdict: result.verdict,
      total: result.total,
      blockers: result.blockers.map((b) => b.code),
    });
    return { assessmentId };
  });

  if ('status' in outcome && outcome.status === 'schema_pending') {
    // The verdict is still returned: it is derived, not stored, so the operator
    // sees the rubric's answer even though nothing was recorded.
    return { ...SCHEMA_PENDING, ...summarise(result) };
  }

  return { ...outcome, ...summarise(result), status: result.verdict };
};

function summarise(result: ReturnType<typeof assessProspect>): Record<string, unknown> {
  return {
    verdict: result.verdict,
    total: result.total,
    scores: result.scores,
    blockers: result.blockers,
    unknowns: result.unknowns,
    expiresAt: result.expiresAt,
  };
}

interface ProspectRow {
  leadId: string;
  businessName: string;
  leadStatus: string;
  verdict: string | null;
  total: number | null;
  assessedAt: string | null;
  expiresAt: string | null;
  expired: boolean;
  demoState: string | null;
  queueId: string | null;
}

/**
 * prospecting.workspace — the review surface.
 *
 * Read-only by construction: it decides nothing and writes nothing, which is
 * what lets an operator look at the funnel without any risk of moving it. Each
 * row carries the standing verdict, whether it has gone stale, and the demo
 * slot, because those three together are what an operator needs to choose the
 * next action.
 */
export const prospectingWorkspace: CapabilityHandler = async (ctx, input) => {
  const wanted = text(input.verdict);
  const limit = typeof input.limit === 'number' && input.limit > 0 ? Math.min(input.limit, 200) : 50;
  const now = new Date();

  const outcome = await withSchema(async () => {
    /*
     * The latest assessment per lead is the standing verdict; earlier rows are
     * history. `distinct on` picks it in one pass rather than reading the whole
     * table and reducing in application code.
     */
    const res = await ctx.q.query(
      `select l.lead_id, l.business_name, l.status as lead_status,
              a.verdict, a.total, a.created_at as assessed_at, a.expires_at,
              d.queue_id, d.state as demo_state
         from leads l
         left join lateral (
           select verdict, total, created_at, expires_at
             from qualification_assessments qa
            where qa.lead_id = l.lead_id
            order by qa.created_at desc
            limit 1
         ) a on true
         left join demo_queue d on d.lead_id = l.lead_id and d.state <> 'expired'
        order by l.created_at desc
        limit $1`,
      [limit],
    );

    const prospects: ProspectRow[] = res.rows.map((r) => {
      const expiresAt = r.expires_at ? new Date(String(r.expires_at)).toISOString() : null;
      return {
        leadId: String(r.lead_id),
        businessName: String(r.business_name ?? ''),
        leadStatus: String(r.lead_status ?? ''),
        verdict: r.verdict ? String(r.verdict) : null,
        total: r.total === null || r.total === undefined ? null : Number(r.total),
        assessedAt: r.assessed_at ? new Date(String(r.assessed_at)).toISOString() : null,
        expiresAt,
        expired: expiresAt === null ? false : assessmentExpired(expiresAt, now),
        demoState: r.demo_state ? String(r.demo_state) : null,
        queueId: r.queue_id ? String(r.queue_id) : null,
      };
    });

    const active = prospects.filter((p) => p.demoState !== null).length;
    return {
      prospects: wanted === null ? prospects : prospects.filter((p) => p.verdict === wanted),
      queue: {
        active,
        cap: DEMO_QUEUE_CAP,
        floor: DEMO_QUEUE_FLOOR,
        remaining: Math.max(0, DEMO_QUEUE_CAP - active),
        belowFloor: active < DEMO_QUEUE_FLOOR,
      },
    };
  });

  if ('status' in outcome && outcome.status === 'schema_pending') {
    return { ...SCHEMA_PENDING, prospects: [], queue: {} };
  }
  return { ...outcome, status: 'ok' };
};

/**
 * demos.enqueue — admit a qualified prospect to a demo slot.
 *
 * The standing verdict is re-read here rather than trusted from the caller.
 * A demo is the first thing a prospect ever sees of Atlas, so building one for
 * someone nobody qualified is how a page gets made from facts nobody checked.
 */
export const demosEnqueue: CapabilityHandler = async (ctx, input) => {
  const leadId = text(input.leadId);
  if (leadId === null) throw new CapabilityError(400, 'demos.enqueue: leadId is required');
  if (ctx.spaceId === null) {
    throw new CapabilityError(400, 'demos.enqueue requires a space (x-atlas-space)');
  }

  await requireLead(ctx, leadId);
  const now = new Date();

  const outcome = await withSchema(async () => {
    const standing = await ctx.q.query(
      `select assessment_id, verdict, expires_at
         from qualification_assessments
        where lead_id = $1
        order by created_at desc
        limit 1`,
      [leadId],
    );
    const assessment = standing.rows[0];
    const expiresAt = assessment?.expires_at ? new Date(String(assessment.expires_at)).toISOString() : null;

    const activeRows = await ctx.q.query(
      `select queue_id, lead_id, state from demo_queue where state <> 'expired'`,
      [],
    );
    const active: QueuedDemo[] = activeRows.rows.map((r) => ({
      queueId: String(r.queue_id),
      leadId: String(r.lead_id),
      state: String(r.state) as QueuedDemo['state'],
    }));

    const plan = planEnqueue({
      leadId,
      verdict: assessment?.verdict ? String(assessment.verdict) : null,
      assessmentExpired: expiresAt === null ? true : assessmentExpired(expiresAt, now),
      active,
    });

    if (!plan.ok) {
      await insertAudit(ctx.q, ctx.spaceId, ctx.auth.actor, 'demos.enqueue_refused', leadId, {
        code: plan.code,
      });
      return { enqueued: false, code: plan.code, note: plan.message, status: 'refused' };
    }

    const expiry = demoExpiry(now);
    const inserted = await ctx.q.query(
      `insert into demo_queue (space_id, lead_id, state, assessment_id, queued_by, expires_at)
       values ($1, $2, 'queued', $3, $4, $5)
       returning queue_id`,
      [ctx.spaceId, leadId, assessment?.assessment_id ?? null, ctx.auth.actor, expiry.toISOString()],
    );
    const queueId = String(inserted.rows[0]?.queue_id ?? '');
    if (queueId === '') throw new CapabilityError(500, 'demos.enqueue: slot was not persisted');

    await insertAudit(ctx.q, ctx.spaceId, ctx.auth.actor, 'demos.enqueued', queueId, {
      leadId,
      remaining: plan.remaining,
    });

    return {
      enqueued: true,
      queueId,
      state: 'queued',
      remaining: plan.remaining,
      belowFloor: plan.belowFloor,
      expiresAt: expiry.toISOString(),
      status: 'queued',
    };
  });

  if ('status' in outcome && outcome.status === 'schema_pending') {
    return { ...SCHEMA_PENDING, enqueued: false };
  }
  return outcome;
};

/**
 * demos.advance — move one slot by exactly one declared step, or expire it.
 *
 * The current state is read from the row rather than supplied, so a caller
 * cannot describe a demo as further along than it is and step from there.
 */
export const demosAdvance: CapabilityHandler = async (ctx, input) => {
  const queueId = text(input.queueId);
  const to = text(input.state);
  if (queueId === null) throw new CapabilityError(400, 'demos.advance: queueId is required');
  if (to === null) throw new CapabilityError(400, 'demos.advance: state is required');
  const siteId = text(input.siteId);

  const outcome = await withSchema(async () => {
    const found = await ctx.q.query(`select queue_id, state from demo_queue where queue_id = $1`, [
      queueId,
    ]);
    const row = found.rows[0];
    if (!row) throw new CapabilityError(404, 'demos.advance: demo slot not found');

    const plan = planAdvance(String(row.state), to);
    if (!plan.ok) {
      await insertAudit(ctx.q, ctx.spaceId, ctx.auth.actor, 'demos.advance_refused', queueId, {
        code: plan.code,
        from: String(row.state),
        to,
      });
      return { advanced: false, code: plan.code, note: plan.message, status: 'refused' };
    }

    await ctx.q.query(
      `update demo_queue
          set state = $2,
              site_id = coalesce($3, site_id),
              updated_at = now()
        where queue_id = $1`,
      [queueId, plan.to, siteId],
    );
    await insertAudit(ctx.q, ctx.spaceId, ctx.auth.actor, 'demos.advanced', queueId, {
      from: plan.from,
      to: plan.to,
    });

    return { advanced: true, queueId, from: plan.from, to: plan.to, status: plan.to };
  });

  if ('status' in outcome && outcome.status === 'schema_pending') {
    return { ...SCHEMA_PENDING, advanced: false };
  }
  return outcome;
};
