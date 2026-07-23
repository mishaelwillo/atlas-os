/**
 * Railway worker entry (brief §4): polls `schedules` every 30s, executes due
 * ones via runs.execute semantics under a per-space system context. Outputs
 * that need action land in the approvals queue (runs.execute gates them);
 * nothing outbound is ever sent from here (SECURITY.md inv. 5).
 * Start: node dist/worker.js
 */
import { runSchedulerTick, type ScheduleRow, type SchedulerStore } from '@atlas/scheduler';
import { buildDeps } from './deps.js';
import { executeCapability, insertAudit, type PipelineDeps } from './pipeline.js';

const TICK_MS = 30_000;

export function createSchedulerStore(deps: PipelineDeps): SchedulerStore {
  return {
    async listEnabled(): Promise<ScheduleRow[]> {
      const res = await deps.db.query(
        `select schedule_id, space_id, capability, cron, input, iteration_cap, last_run_at
           from schedules where enabled = true`,
      );
      return res.rows.map((r) => ({
        scheduleId: String(r.schedule_id),
        spaceId: String(r.space_id),
        capability: String(r.capability),
        cron: String(r.cron),
        input: (r.input ?? {}) as Record<string, unknown>,
        iterationCap: Number(r.iteration_cap),
        lastRunAt: r.last_run_at === null ? null : new Date(String(r.last_run_at)),
      }));
    },

    async countRuns24h(scheduleId: string): Promise<number> {
      const res = await deps.db.query(
        `select count(*)::int as n from runs
          where input ->> 'scheduleId' = $1 and created_at > now() - interval '24 hours'`,
        [scheduleId],
      );
      return Number(res.rows[0]?.n ?? 0);
    },

    async execute(row: ScheduleRow): Promise<void> {
      const meta = deps.capabilities['runs.execute'];
      const result = await executeCapability(
        meta,
        { kind: 'system', actor: `scheduler:${row.scheduleId}`, spaceId: row.spaceId, scopes: ['*'] },
        {
          capability: row.capability,
          // scheduleId rides inside input so the cap window can be counted
          input: { ...row.input, scheduleId: row.scheduleId },
        },
        deps,
      );
      if (result.statusCode >= 400) {
        throw new Error(`runs.execute → HTTP ${result.statusCode}: ${JSON.stringify(result.body)}`);
      }
    },

    async markRan(scheduleId: string, at: Date): Promise<void> {
      await deps.db.query('update schedules set last_run_at = $2 where schedule_id = $1', [scheduleId, at]);
    },

    async auditCapExceeded(row: ScheduleRow, used: number): Promise<void> {
      await deps.db.withSpace(row.spaceId, (q) =>
        insertAudit(q, row.spaceId, `scheduler:${row.scheduleId}`, 'schedule.cap_exceeded', row.capability, {
          iterationCap: row.iterationCap,
          used,
        }),
      );
    },
  };
}

async function main(): Promise<void> {
  const deps = buildDeps();
  const store = createSchedulerStore(deps);
  console.log('[worker] Atlas scheduler worker up — tick every', TICK_MS, 'ms');

  const tick = async (): Promise<void> => {
    try {
      const r = await runSchedulerTick(store, new Date(), deps.log);
      if (r.executed > 0 || r.cappedSkips > 0 || r.errors > 0) {
        console.log('[worker] tick', JSON.stringify(r));
      }
    } catch (err) {
      console.error('[worker] tick failed', err);
    }
  };

  await tick();
  setInterval(() => void tick(), TICK_MS);
}

// Only run when invoked directly (not when imported by tests).
if (process.argv[1] && /worker\.[cm]?js$/.test(process.argv[1])) {
  void main();
}
