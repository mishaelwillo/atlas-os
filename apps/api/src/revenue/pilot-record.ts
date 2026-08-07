/**
 * The pilot's cost, support and outcome record
 * (docs/specs/p2/revenue-pilot.md).
 *
 * Exit criterion: "One paying customer **and complete cost/support/outcome
 * record** satisfy pilot exit; zero customers is recorded as evidence, not
 * concealed."
 *
 * The second half of that had no implementation. `funnel.ts` listed six
 * metrics as unavailable — provider_cost, labour_cost, support_time,
 * satisfaction, time_per_stage, demo_cost — naming them rather than defaulting
 * them to zero so the gap could not be mistaken for a measurement. This module
 * is what closes them.
 *
 * Two of the six were never missing data, only missing arithmetic:
 * `time_per_stage` and days-to-activation come from timestamps the pilot
 * already writes. They are derived here rather than recorded, because a
 * duration an operator types is a duration that can disagree with the rows it
 * describes.
 *
 * Pure and deterministic — no clock, no database, no network.
 */

/**
 * What a cost entry can be about.
 *
 * Must stay identical to the check constraint in
 * `supabase/migrations/0012_pilot_cost_and_outcome.sql`.
 */
export const COST_CATEGORIES = ['provider', 'labour', 'support', 'demo'] as const;

export type CostCategory = (typeof COST_CATEGORIES)[number];

export function isCostCategory(value: unknown): value is CostCategory {
  return (COST_CATEGORIES as readonly unknown[]).includes(value);
}

export const MIN_SATISFACTION = 1;
export const MAX_SATISFACTION = 5;

export type CostRefusalCode =
  | 'unknown_category'
  | 'money_and_time'
  | 'neither_money_nor_time'
  | 'currency_missing'
  | 'negative_amount'
  | 'note_missing';

export interface CostRefusal {
  ok: false;
  code: CostRefusalCode;
  message: string;
}

export interface CostPlan {
  ok: true;
  category: CostCategory;
  /** Exactly one of these is set; the other is null. */
  amountMinor: number | null;
  currency: string | null;
  minutes: number | null;
  note: string;
}

export interface CostInput {
  category: string;
  amountMinor: number | null;
  currency: string | null;
  minutes: number | null;
  note: string | null;
}

/**
 * Decide whether a cost entry may be recorded.
 *
 * **Money and time are never both, and never neither.** Labour and support are
 * naturally hours; provider and demo are naturally money. Converting between
 * them needs an hourly rate nobody has supplied, and inventing one would
 * produce a gross margin that looks authoritative and is made up — the same
 * reason `offers` refuses a default price. So an entry carries one or the
 * other, the funnel reports them separately, and no total mixes them.
 *
 * Zero is accepted for both. A provider that charged nothing this month is a
 * real observation, and the pilot's cost record is worth more with it in.
 */
export function planCostEntry(input: CostInput): CostPlan | CostRefusal {
  if (!isCostCategory(input.category)) {
    return {
      ok: false,
      code: 'unknown_category',
      message: `'${input.category}' is not a cost category; expected ${COST_CATEGORIES.join(', ')}`,
    };
  }

  const hasMoney = input.amountMinor !== null;
  const hasTime = input.minutes !== null;

  if (hasMoney && hasTime) {
    return {
      ok: false,
      code: 'money_and_time',
      message:
        'record either an amount or minutes, not both — nothing converts between them, so an entry carrying both cannot be summed either way',
    };
  }
  if (!hasMoney && !hasTime) {
    return {
      ok: false,
      code: 'neither_money_nor_time',
      message: 'a cost entry needs either an amount or minutes; an entry with neither records nothing',
    };
  }
  if (hasMoney && (input.currency === null || input.currency.trim() === '')) {
    return {
      ok: false,
      code: 'currency_missing',
      message: 'an amount needs its currency; mixed currencies are never summed, so the currency travels with the figure',
    };
  }
  if ((input.amountMinor ?? 0) < 0 || (input.minutes ?? 0) < 0) {
    return {
      ok: false,
      code: 'negative_amount',
      message: 'a cost cannot be negative; record a refund or correction as its own entry with a note',
    };
  }

  const note = (input.note ?? '').trim();
  if (note === '') {
    return {
      ok: false,
      code: 'note_missing',
      message: 'a cost entry needs a note; a figure nobody described cannot be audited later',
    };
  }

  return {
    ok: true,
    category: input.category,
    amountMinor: hasMoney ? input.amountMinor : null,
    currency: hasMoney ? (input.currency as string).trim().toUpperCase() : null,
    minutes: hasTime ? input.minutes : null,
    note,
  };
}

export type OutcomeRefusalCode = 'satisfaction_out_of_range' | 'note_missing';

export interface OutcomeRefusal {
  ok: false;
  code: OutcomeRefusalCode;
  message: string;
}

export interface OutcomePlan {
  ok: true;
  satisfaction: number;
  note: string;
}

/**
 * Decide whether a satisfaction observation may be recorded.
 *
 * There is no default. An unrecorded satisfaction is a gap in the pilot's
 * record, and filling it with a middle value would turn "nobody asked" into
 * "they were indifferent" — a different and unearned claim.
 */
export function planOutcome(input: { satisfaction: number; note: string | null }): OutcomePlan | OutcomeRefusal {
  if (
    !Number.isInteger(input.satisfaction) ||
    input.satisfaction < MIN_SATISFACTION ||
    input.satisfaction > MAX_SATISFACTION
  ) {
    return {
      ok: false,
      code: 'satisfaction_out_of_range',
      message: `satisfaction is a whole number from ${MIN_SATISFACTION} to ${MAX_SATISFACTION}`,
    };
  }
  const note = (input.note ?? '').trim();
  if (note === '') {
    return {
      ok: false,
      code: 'note_missing',
      message: 'a satisfaction score needs a note saying what it is based on',
    };
  }
  return { ok: true, satisfaction: input.satisfaction, note };
}

/**
 * Whether the pilot's record is complete enough to claim the exit criterion.
 *
 * Derived, never declared. A boolean an operator ticks is a claim nothing
 * checks — the same shape as every defect this codebase has found — so
 * completeness is computed from what is actually recorded, and the gaps are
 * named so the answer is actionable rather than merely negative.
 *
 * "At least one entry per category" is a floor, not a proof of thoroughness,
 * and it is described that way wherever it is reported. It is still worth far
 * more than a tick box: it cannot be true while a category is empty.
 */
export interface RecordCompleteness {
  complete: boolean;
  /** Cost categories with no entry for this customer. */
  missingCategories: CostCategory[];
  /** True when no satisfaction observation exists. */
  satisfactionMissing: boolean;
}

export function assessRecord(input: {
  categoriesRecorded: readonly string[];
  hasSatisfaction: boolean;
}): RecordCompleteness {
  const seen = new Set(input.categoriesRecorded);
  const missingCategories = COST_CATEGORIES.filter((c) => !seen.has(c));
  return {
    complete: missingCategories.length === 0 && input.hasSatisfaction,
    missingCategories,
    satisfactionMissing: !input.hasSatisfaction,
  };
}

/**
 * The stages whose duration the pilot can derive, in order.
 *
 * Each is the gap between two timestamps the pilot already writes. Nothing
 * here is typed in by an operator, so no duration can disagree with the rows
 * it describes.
 */
export const TIMED_STAGES = [
  'sourced_to_assessed',
  'assessed_to_demo_queued',
  'demo_queued_to_shareable',
  'shareable_to_first_touch',
  'first_touch_to_offer',
  'offer_to_accepted',
  'accepted_to_activated',
] as const;

export type TimedStage = (typeof TIMED_STAGES)[number];

export interface StageTimestamps {
  sourced: string | null;
  assessed: string | null;
  demoQueued: string | null;
  demoShareable: string | null;
  firstTouch: string | null;
  offerPublished: string | null;
  dealAccepted: string | null;
  hostingActivated: string | null;
}

function hoursBetween(from: string | null, to: string | null): number | null {
  if (from === null || to === null) return null;
  const start = Date.parse(from);
  const end = Date.parse(to);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  /*
   * A negative gap means the timestamps disagree with the order the stages are
   * supposed to happen in. That is a finding, not a duration, so it reports as
   * unknown rather than as a negative number nobody can act on.
   */
  if (end < start) return null;
  return Math.round(((end - start) / 3_600_000) * 100) / 100;
}

/**
 * Hours per stage, and null for any stage a customer has not reached.
 *
 * Null is "not reached yet", which is a different fact from zero. Zero would
 * say the stage took no time; the funnel renders null as an em dash for the
 * same reason a rate with no denominator is not reported as 0%.
 */
export function stageDurations(at: StageTimestamps): Record<TimedStage, number | null> {
  return {
    sourced_to_assessed: hoursBetween(at.sourced, at.assessed),
    assessed_to_demo_queued: hoursBetween(at.assessed, at.demoQueued),
    demo_queued_to_shareable: hoursBetween(at.demoQueued, at.demoShareable),
    shareable_to_first_touch: hoursBetween(at.demoShareable, at.firstTouch),
    first_touch_to_offer: hoursBetween(at.firstTouch, at.offerPublished),
    offer_to_accepted: hoursBetween(at.offerPublished, at.dealAccepted),
    accepted_to_activated: hoursBetween(at.dealAccepted, at.hostingActivated),
  };
}

/** Sourced to serving, the number the pilot is actually judged on. */
export function daysToActivation(at: StageTimestamps): number | null {
  const hours = hoursBetween(at.sourced, at.hostingActivated);
  return hours === null ? null : Math.round((hours / 24) * 100) / 100;
}

export interface MarginInput {
  recurringMinorByCurrency: Record<string, number>;
  costMinorByCurrency: Record<string, number>;
  /** Whether every cost category has an entry; a partial record cannot margin. */
  costRecordComplete: boolean;
}

export interface MarginReport {
  /** Per currency, or null throughout when the cost record is incomplete. */
  grossMarginMinorByCurrency: Record<string, number> | null;
  /** Why margin is absent, when it is. */
  unavailableReason: string | null;
  /** Time that has no money value because no rate was supplied. */
  unpricedMinutes: number;
}

/**
 * Gross margin, or an honest refusal.
 *
 * **A margin from a partial cost record is worse than no margin.** It looks
 * authoritative, it is always too high, and the number it is missing is
 * exactly the one nobody got round to recording. So margin is reported only
 * when every cost category has at least one entry, and otherwise names the
 * reason.
 *
 * Recorded minutes are reported separately and never converted. There is no
 * hourly rate in Atlas, and inventing one to make margin look complete would
 * be the same lie in a different place.
 */
export function grossMargin(input: MarginInput): MarginReport {
  if (!input.costRecordComplete) {
    return {
      grossMarginMinorByCurrency: null,
      unavailableReason:
        'the cost record is incomplete, and a margin computed from part of the costs is always too high',
      unpricedMinutes: 0,
    };
  }
  const currencies = new Set([
    ...Object.keys(input.recurringMinorByCurrency),
    ...Object.keys(input.costMinorByCurrency),
  ]);
  const margin: Record<string, number> = {};
  for (const currency of currencies) {
    margin[currency] =
      (input.recurringMinorByCurrency[currency] ?? 0) - (input.costMinorByCurrency[currency] ?? 0);
  }
  return { grossMarginMinorByCurrency: margin, unavailableReason: null, unpricedMinutes: 0 };
}
