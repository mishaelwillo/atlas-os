/**
 * status.mission_control — declarative Home cards. The UI renders THIS JSON;
 * no bespoke fetches (brief §5). Real queries: pending approvals, last runs,
 * schedules due, cache-hit rate from runs.answered_by, model-chain health.
 */
import type { Queryable } from '../db.js';
import type { CapabilityHandler } from '../pipeline.js';

/** The migration identity the drift collector reads, asked of the live database. */
const MIGRATION_QUERY = `select version || '_' || name as migration_identity
from supabase_migrations.schema_migrations
order by version desc
limit 1`;

/**
 * Read the applied migration identity, or null when it cannot be observed.
 * Unreadable is reported as unknown — never as agreement — because a card that
 * silently claims a match is worse than one that admits it does not know.
 */
async function observedMigration(q: Queryable): Promise<string | null> {
  try {
    const res = await q.query(MIGRATION_QUERY);
    const row = res.rows[0];
    const value = row?.migration_identity;
    return typeof value === 'string' && value.trim() !== '' ? value : null;
  } catch {
    return null;
  }
}

interface DeploymentFinding {
  code: string;
  severity: 'blocking' | 'unknown';
  message: string;
}

/**
 * Compare what this deployment claims about the schema against what the
 * database actually reports. Nothing else cross-checks these two, so a service
 * publishing a stale-but-well-formed schema version would otherwise pass every
 * gate.
 */
export function deploymentFindings(
  claimedSchema: string,
  observed: string | null,
): DeploymentFinding[] {
  if (observed === null) {
    return [
      {
        code: 'database.migration_unknown',
        severity: 'unknown',
        message: 'Applied migration identity could not be read from the database.',
      },
    ];
  }
  if (claimedSchema === 'unknown') {
    return [
      {
        code: 'service.schema_unknown',
        severity: 'unknown',
        message: `This deployment does not declare a schema version; the database reports ${observed}.`,
      },
    ];
  }
  if (claimedSchema !== observed) {
    return [
      {
        code: 'deployment.schema_mismatch',
        severity: 'blocking',
        message: `This deployment reports schema ${claimedSchema} but the database has ${observed}.`,
      },
    ];
  }
  return [];
}

export const statusMissionControl: CapabilityHandler = async (ctx) => {
  const space = ctx.spaceId; // null → operator, all spaces

  const [approvals, runs, schedules, ladder, failures, memory, nodes, sites, leads, migration] = await Promise.all([
    ctx.q.query(
      `select approval_id, kind, reason, payload, created_at from approvals
        where status = 'pending' and ($1::uuid is null or space_id = $1::uuid)
        order by created_at asc limit 10`,
      [space],
    ),
    ctx.q.query(
      `select run_id, capability, task_class, status, model_used, answered_by, cost_usd, created_at, finished_at
         from runs where ($1::uuid is null or space_id = $1::uuid)
        order by created_at desc limit 10`,
      [space],
    ),
    ctx.q.query(
      `select schedule_id, capability, cron, iteration_cap, enabled, last_run_at
         from schedules where enabled = true and ($1::uuid is null or space_id = $1::uuid)
        order by created_at asc limit 20`,
      [space],
    ),
    ctx.q.query(
      `select answered_by, count(*)::int as n, coalesce(sum(cost_usd), 0)::numeric as cost
         from runs where answered_by is not null and ($1::uuid is null or space_id = $1::uuid)
        group by answered_by`,
      [space],
    ),
    ctx.q.query(
      `select coalesce(model_used, '(none)') as model, count(*)::int as n
         from runs where status = 'failed' and created_at > now() - interval '24 hours'
          and ($1::uuid is null or space_id = $1::uuid)
        group by 1 order by 2 desc limit 5`,
      [space],
    ),
    ctx.q.query(
      `select count(*)::int as cards,
              count(*) filter (where quarantined_at is not null)::int as quarantined,
              max(created_at) as newest
         from memory_cards where ($1::uuid is null or space_id = $1::uuid)`,
      [space],
    ),
    ctx.q.query(
      `select truth_status, count(*)::int as n
         from memory_nodes where ($1::uuid is null or space_id = $1::uuid)
        group by truth_status`,
      [space],
    ),
    ctx.q.query(
      `select site_id, business_name, status, template, updated_at
         from sites where ($1::uuid is null or space_id = $1::uuid)
        order by updated_at desc limit 20`,
      [space],
    ),
    ctx.q.query(
      `select lead_id, business_name, status, phone, score
         from leads where ($1::uuid is null or space_id = $1::uuid)
          and status not in ('suppressed', 'lost')
        order by score desc, created_at desc limit 25`,
      [space],
    ),
    observedMigration(ctx.q),
  ]);

  const rungCounts: Record<string, number> = {};
  let modelCost = 0;
  let modelRuns = 0;
  for (const row of ladder.rows) {
    const rung = String(row.answered_by);
    const n = Number(row.n);
    rungCounts[rung] = n;
    if (rung === 'model') {
      modelRuns = n;
      modelCost = Number(row.cost);
    }
  }
  const cacheHits = rungCounts.cache ?? 0;
  const answeredTotal = Object.values(rungCounts).reduce((a, b) => a + b, 0);
  const cacheHitRate = answeredTotal > 0 ? cacheHits / answeredTotal : 0;
  const avgModelCost = modelRuns > 0 ? modelCost / modelRuns : 0;
  const dollarsSavedUsd = Number((cacheHits * avgModelCost).toFixed(4));

  const memoryRow = memory.rows[0] ?? {};
  const newestCardAt = memoryRow.newest === null || memoryRow.newest === undefined ? null : String(memoryRow.newest);
  const truthCounts: Record<string, number> = {};
  for (const row of nodes.rows) truthCounts[String(row.truth_status)] = Number(row.n);

  const build = ctx.deps.buildInfo;
  const findings = deploymentFindings(build.schemaVersion, migration);

  const env = ctx.deps.env;
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    cards: [
      {
        id: 'approvals',
        kind: 'approvals',
        title: 'Pending approvals',
        data: {
          count: approvals.rows.length,
          items: approvals.rows.map((r) => ({
            approvalId: String(r.approval_id),
            kind: String(r.kind),
            reason: String(r.reason),
            payload: r.payload,
            createdAt: String(r.created_at),
          })),
        },
      },
      {
        id: 'runs',
        kind: 'runs',
        title: 'Live runs',
        data: {
          items: runs.rows.map((r) => ({
            runId: String(r.run_id),
            capability: String(r.capability),
            taskClass: String(r.task_class),
            status: String(r.status),
            model: r.model_used === null ? null : String(r.model_used),
            answeredBy: r.answered_by === null ? null : String(r.answered_by),
            costUsd: Number(r.cost_usd),
            createdAt: String(r.created_at),
          })),
        },
      },
      {
        id: 'models',
        kind: 'model_chain',
        title: 'Model-chain health',
        data: {
          chains: { think: env.chainThink, do: env.chainDo, quick: env.chainQuick },
          failures24h: failures.rows.map((r) => ({ model: String(r.model), count: Number(r.n) })),
        },
      },
      {
        id: 'cache',
        kind: 'cache',
        title: 'Token ladder',
        data: { cacheHitRate, rungCounts, dollarsSavedUsd, modelCostUsd: Number(modelCost.toFixed(4)) },
      },
      {
        id: 'memory',
        kind: 'memory',
        title: 'Memory freshness',
        data: {
          cards: Number(memoryRow.cards ?? 0),
          quarantined: Number(memoryRow.quarantined ?? 0),
          // Null means no card has ever been ingested, not "fresh".
          newestCardAt,
          nodesByTruthStatus: truthCounts,
        },
      },
      {
        id: 'leads',
        kind: 'leads',
        title: 'Leads',
        data: {
          items: leads.rows.map((r) => ({
            leadId: String(r.lead_id),
            businessName: String(r.business_name),
            status: String(r.status),
            phone: r.phone === null ? null : String(r.phone),
            score: Number(r.score),
          })),
        },
      },
      {
        id: 'sites',
        kind: 'sites',
        title: 'Sites',
        data: {
          items: sites.rows.map((r) => ({
            siteId: String(r.site_id),
            businessName: String(r.business_name),
            status: String(r.status),
            template: r.template === null ? null : String(r.template),
            updatedAt: String(r.updated_at),
          })),
        },
      },
      {
        id: 'deployment',
        kind: 'deployment',
        title: 'Deployment',
        data: {
          service: {
            gitSha: build.gitSha,
            buildTime: build.buildTime,
            schemaVersion: build.schemaVersion,
            registryVersion: build.registryVersion,
          },
          // Null is an admitted unknown, never treated as agreement.
          observedMigration: migration,
          findings,
        },
      },
      {
        id: 'schedules',
        kind: 'schedules',
        title: 'Schedules',
        data: {
          items: schedules.rows.map((r) => ({
            scheduleId: String(r.schedule_id),
            capability: String(r.capability),
            cron: String(r.cron),
            iterationCap: Number(r.iteration_cap),
            lastRunAt: r.last_run_at === null ? null : String(r.last_run_at),
          })),
        },
      },
    ],
  };
};
