/**
 * status.mission_control — declarative Home cards. The UI renders THIS JSON;
 * no bespoke fetches (brief §5). Real queries: pending approvals, last runs,
 * schedules due, cache-hit rate from runs.answered_by, model-chain health.
 */
import type { CapabilityHandler } from '../pipeline.js';

export const statusMissionControl: CapabilityHandler = async (ctx) => {
  const space = ctx.spaceId; // null → operator, all spaces

  const [approvals, runs, schedules, ladder, failures] = await Promise.all([
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
