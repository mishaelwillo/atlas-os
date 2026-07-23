/**
 * @atlas/scheduler — polls `schedules` due by cron, honors iteration_cap,
 * executes via runs.execute (which itself holds approval-gated capabilities in
 * the approvals queue). SECURITY.md inv. 5: no always-on loop may send
 * anything outbound directly — this package only creates runs/approvals.
 * Storage access is injected so the API worker and tests share the logic.
 */
import { cronMatches } from './cron.js';

export { cronMatches, parseCron } from './cron.js';

export interface ScheduleRow {
  scheduleId: string;
  spaceId: string;
  capability: string;
  cron: string;
  input: Record<string, unknown>;
  iterationCap: number;
  lastRunAt: Date | null;
}

export interface SchedulerStore {
  /** All enabled schedules. */
  listEnabled(): Promise<ScheduleRow[]>;
  /** Runs attributed to this schedule in the trailing 24h (cap window). */
  countRuns24h(scheduleId: string): Promise<number>;
  /** Execute the schedule's capability via runs.execute semantics. */
  execute(row: ScheduleRow): Promise<void>;
  markRan(scheduleId: string, at: Date): Promise<void>;
  /** Audit trail for cap-exceeded skips. */
  auditCapExceeded(row: ScheduleRow, used: number): Promise<void>;
}

export interface TickResult {
  considered: number;
  executed: number;
  cappedSkips: number;
  errors: number;
}

const minuteStart = (d: Date): Date => new Date(Math.floor(d.getTime() / 60000) * 60000);

/**
 * One dispatcher tick. A schedule fires at most once per matching minute
 * (lastRunAt >= start of the current minute → already fired).
 */
export async function runSchedulerTick(
  store: SchedulerStore,
  now: Date = new Date(),
  log: { warn: (o: unknown, m?: string) => void } = { warn: () => undefined },
): Promise<TickResult> {
  const result: TickResult = { considered: 0, executed: 0, cappedSkips: 0, errors: 0 };
  const windowStart = minuteStart(now);

  for (const row of await store.listEnabled()) {
    result.considered += 1;
    let due: boolean;
    try {
      due = cronMatches(row.cron, now);
    } catch (err) {
      result.errors += 1;
      log.warn({ scheduleId: row.scheduleId, cron: row.cron, err: String(err) }, 'invalid cron expression');
      continue;
    }
    if (!due) continue;
    if (row.lastRunAt !== null && row.lastRunAt >= windowStart) continue; // already fired this minute

    const used = await store.countRuns24h(row.scheduleId);
    if (used >= row.iterationCap) {
      result.cappedSkips += 1;
      await store.auditCapExceeded(row, used);
      continue;
    }

    try {
      await store.execute(row);
      await store.markRan(row.scheduleId, now);
      result.executed += 1;
    } catch (err) {
      result.errors += 1;
      log.warn({ scheduleId: row.scheduleId, err: String(err) }, 'schedule execution failed');
    }
  }
  return result;
}
