/**
 * Dependency-free 5-field cron matcher: minute hour day-of-month month day-of-week.
 * Supports: * , lists (1,2,3), ranges (1-5), steps (*\/15, 1-30/5). UTC.
 * (Brief allows no new deps; schedules.cron uses standard 5-field syntax.)
 */

function expandField(field: string, min: number, max: number): Set<number> | 'any' {
  if (field === '*') return 'any';
  const out = new Set<number>();
  for (const part of field.split(',')) {
    const [rangePart, stepPart] = part.split('/');
    const step = stepPart !== undefined ? Number(stepPart) : 1;
    if (!Number.isInteger(step) || step < 1) throw new Error(`bad cron step in '${part}'`);
    let lo: number;
    let hi: number;
    if (rangePart === '*' || rangePart === '') {
      lo = min;
      hi = max;
    } else if (rangePart.includes('-')) {
      const [a, b] = rangePart.split('-').map(Number);
      lo = a;
      hi = b;
    } else {
      lo = Number(rangePart);
      hi = stepPart !== undefined ? max : lo;
    }
    if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < min || hi > max || lo > hi) {
      throw new Error(`bad cron field '${part}' (allowed ${min}-${max})`);
    }
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

export interface CronSpec {
  minute: Set<number> | 'any';
  hour: Set<number> | 'any';
  dayOfMonth: Set<number> | 'any';
  month: Set<number> | 'any';
  dayOfWeek: Set<number> | 'any';
}

export function parseCron(expr: string): CronSpec {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) throw new Error(`cron '${expr}' must have 5 fields`);
  return {
    minute: expandField(fields[0], 0, 59),
    hour: expandField(fields[1], 0, 23),
    dayOfMonth: expandField(fields[2], 1, 31),
    month: expandField(fields[3], 1, 12),
    dayOfWeek: expandField(fields[4], 0, 7), // 0 and 7 both mean Sunday
  };
}

const hit = (set: Set<number> | 'any', v: number): boolean => set === 'any' || set.has(v);

export function cronMatches(expr: string, date: Date): boolean {
  const spec = parseCron(expr);
  const dow = date.getUTCDay(); // 0 = Sunday
  const dowMatch =
    spec.dayOfWeek === 'any' ? true : spec.dayOfWeek.has(dow) || (dow === 0 && spec.dayOfWeek.has(7));
  return (
    hit(spec.minute, date.getUTCMinutes()) &&
    hit(spec.hour, date.getUTCHours()) &&
    hit(spec.dayOfMonth, date.getUTCDate()) &&
    hit(spec.month, date.getUTCMonth() + 1) &&
    dowMatch
  );
}
