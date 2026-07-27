/**
 * Pre-approval policy checks (docs/specs/p2/revenue-pilot.md).
 *
 * The outreach workflow is `draft → policy_check → approval_required → …`, so
 * policy runs *before* an approval exists. A suppressed lead must not reach the
 * approval queue at all: putting it there invites an operator to approve
 * something the policy already forbids, and makes the queue the place where
 * safety is decided rather than where work is confirmed.
 *
 * The registry has described `outreach.send` as "daily cap enforced" since P1
 * while nothing enforced it. This makes that claim true.
 */

/** Lead states where a further touch is not permitted. */
export const BLOCKED_LEAD_STATUSES = new Set([
  'suppressed', // opt-out or complaint
  'replied', // the spec stops a sequence on reply
  'won',
  'lost',
]);

export interface PolicyRefusal {
  code: 'lead_suppressed' | 'daily_cap_reached';
  message: string;
}

export interface OutreachPolicyInput {
  /** Null when no lead row matches the supplied reference. */
  leadStatus: string | null;
  /** Touches already drafted or approved for this space today. */
  touchesToday: number;
  dailyCap: number;
}

/**
 * Decide whether one more outreach touch may be drafted.
 *
 * An unknown lead reference is permitted but still capped. Lead sourcing has no
 * directory adapter yet, so operators reference prospects they found by hand;
 * refusing those would block the only workflow that currently exists. A lead
 * absent from the system also cannot carry a suppression we would be ignoring.
 */
export function checkOutreachPolicy(input: OutreachPolicyInput): PolicyRefusal | null {
  if (input.leadStatus !== null && BLOCKED_LEAD_STATUSES.has(input.leadStatus)) {
    return {
      code: 'lead_suppressed',
      message: `lead is '${input.leadStatus}'; no further outreach is permitted`,
    };
  }
  if (input.dailyCap > 0 && input.touchesToday >= input.dailyCap) {
    return {
      code: 'daily_cap_reached',
      message: `daily outreach cap of ${input.dailyCap} reached for this space`,
    };
  }
  return null;
}

/**
 * A cap of zero or less disables the limit rather than blocking everything,
 * which is what an operator setting "0" almost certainly intends — and a
 * misconfiguration that silently halted all outreach would be worse than one
 * that logs an unlimited cap.
 */
export function parseDailyCap(raw: string | undefined, fallback = 10): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) return fallback;
  return parsed;
}
