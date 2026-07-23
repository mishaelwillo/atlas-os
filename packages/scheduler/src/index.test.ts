/** Scheduler tests (brief §6): cap enforcement, cron matching, once-per-minute. */
import { describe, expect, it } from 'vitest';
import { cronMatches, parseCron } from './cron.js';
import { runSchedulerTick, type ScheduleRow, type SchedulerStore } from './index.js';

function row(overrides: Partial<ScheduleRow> = {}): ScheduleRow {
  return {
    scheduleId: 'sch-1',
    spaceId: 'spc-1',
    capability: 'memory.distill',
    cron: '* * * * *',
    input: {},
    iterationCap: 25,
    lastRunAt: null,
    ...overrides,
  };
}

interface StoreLog {
  executed: string[];
  capAudits: string[];
  marked: string[];
}

function fakeStore(rows: ScheduleRow[], runCounts: Record<string, number> = {}): { store: SchedulerStore; log: StoreLog } {
  const log: StoreLog = { executed: [], capAudits: [], marked: [] };
  const store: SchedulerStore = {
    listEnabled: async () => rows,
    countRuns24h: async (id) => runCounts[id] ?? 0,
    execute: async (r) => {
      log.executed.push(r.scheduleId);
    },
    markRan: async (id) => {
      log.marked.push(id);
    },
    auditCapExceeded: async (r) => {
      log.capAudits.push(r.scheduleId);
    },
  };
  return { store, log };
}

describe('cron', () => {
  it('parses and matches basic expressions', () => {
    const d = new Date(Date.UTC(2026, 6, 22, 9, 30)); // 09:30 UTC, a Wednesday
    expect(cronMatches('30 9 * * *', d)).toBe(true);
    expect(cronMatches('31 9 * * *', d)).toBe(false);
    expect(cronMatches('*/15 * * * *', d)).toBe(true);
    expect(cronMatches('* * * * 3', d)).toBe(true); // Wednesday
    expect(cronMatches('* * * * 0', d)).toBe(false);
  });

  it('rejects malformed expressions', () => {
    expect(() => parseCron('* * *')).toThrow(/5 fields/);
    expect(() => parseCron('99 * * * *')).toThrow(/allowed 0-59/);
  });
});

describe('runSchedulerTick', () => {
  it('executes due schedules and marks them ran', async () => {
    const { store, log } = fakeStore([row()]);
    const result = await runSchedulerTick(store, new Date());
    expect(result.executed).toBe(1);
    expect(log.executed).toEqual(['sch-1']);
    expect(log.marked).toEqual(['sch-1']);
  });

  it('enforces iteration_cap: at cap → skip + audit, never execute (SECURITY.md inv. 5)', async () => {
    const { store, log } = fakeStore(
      [row({ scheduleId: 'capped', iterationCap: 2 }), row({ scheduleId: 'free', iterationCap: 5 })],
      { capped: 2, free: 1 },
    );
    const result = await runSchedulerTick(store, new Date());
    expect(result.cappedSkips).toBe(1);
    expect(result.executed).toBe(1);
    expect(log.capAudits).toEqual(['capped']);
    expect(log.executed).toEqual(['free']);
  });

  it('fires at most once per matching minute', async () => {
    const now = new Date();
    const { store, log } = fakeStore([row({ lastRunAt: now })]);
    const result = await runSchedulerTick(store, now);
    expect(result.executed).toBe(0);
    expect(log.executed).toEqual([]);
  });

  it('skips non-matching cron without executing', async () => {
    const now = new Date(Date.UTC(2026, 6, 22, 9, 30));
    const { store, log } = fakeStore([row({ cron: '0 0 1 1 *' })]);
    const result = await runSchedulerTick(store, now);
    expect(result.executed).toBe(0);
    expect(log.executed).toEqual([]);
  });

  it('counts invalid cron as an error, not a crash', async () => {
    const { store } = fakeStore([row({ cron: 'not a cron' })]);
    const result = await runSchedulerTick(store, new Date());
    expect(result.errors).toBe(1);
    expect(result.executed).toBe(0);
  });
});
