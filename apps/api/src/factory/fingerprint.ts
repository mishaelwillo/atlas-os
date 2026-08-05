/**
 * Post-publish fingerprint read-back (docs/specs/p2/website-factory.md).
 *
 * Acceptance: "public fingerprint equals approved build" and "deployment
 * records fingerprint and supports verified rollback".
 *
 * Until this existed, the deployment row recorded the hash Atlas *intended* to
 * publish and nothing ever read the public address back to see whether that is
 * what arrives. The 2026-08-03 benchmark found the gap the hard way: the Pages
 * origin served the approved bytes exactly, while the public address served 938
 * bytes more, because the zone injects a bot-detection script. The deployment
 * said `live` and claimed a fingerprint it had never checked.
 *
 * So the check reads what the public actually receives and records it. A
 * mismatch does not un-publish anything — the site is serving, and pretending
 * otherwise would be its own lie — it is recorded, and an operator is told.
 *
 * The comparison itself is pure; fetching is the caller's job.
 */
import { createHash } from 'node:crypto';

export type FingerprintVerdict = 'match' | 'mismatch' | 'unreadable';

export interface FingerprintResult {
  verdict: FingerprintVerdict;
  /** sha256 of what the public address served; null when it could not be read. */
  observed: string | null;
  approved: string;
  matches: boolean;
  message: string;
}

/** sha256 of a served body, the same digest the renderer produces. */
export function sha256(body: string): string {
  return createHash('sha256').update(body, 'utf8').digest('hex');
}

export interface ReadPublicResult {
  status: number;
  body: string;
}

/**
 * Compare what the public address served against the build that was approved.
 *
 * An unreadable address is deliberately NOT a match. A read-back that fell back
 * to "assume fine" on a network error would be worse than no read-back, because
 * the row would then carry a verified-looking fingerprint that nothing verified.
 */
export function classifyFingerprint(args: {
  approved: string;
  read: ReadPublicResult | null;
  error?: string | null;
}): FingerprintResult {
  const approved = args.approved;

  if (args.read === null) {
    return {
      verdict: 'unreadable',
      observed: null,
      approved,
      matches: false,
      message: `the published address could not be read back${args.error ? `: ${args.error}` : ''}`,
    };
  }
  if (args.read.status !== 200) {
    return {
      verdict: 'unreadable',
      observed: null,
      approved,
      matches: false,
      message: `the published address answered ${args.read.status}, so nothing could be compared`,
    };
  }

  const observed = sha256(args.read.body);
  if (observed === approved) {
    return {
      verdict: 'match',
      observed,
      approved,
      matches: true,
      message: 'the public address serves exactly the approved build',
    };
  }

  return {
    verdict: 'mismatch',
    observed,
    approved,
    matches: false,
    message: `the public address serves ${observed.slice(0, 12)}, not the approved ${approved.slice(0, 12)}; something between the build and the reader changed the bytes`,
  };
}

/**
 * Attempts before a non-matching read is believed.
 *
 * Six attempts two seconds apart — about ten seconds of waiting — was too
 * short. In the 2026-08-04 loop run, two of three publishes recorded a
 * `mismatch` that was not one: the address served the approved build correctly
 * within a minute, and the hourly sweep then recorded a match. A
 * `fingerprint_matches: false` on a healthy site is the kind of false alarm
 * that teaches an operator to ignore the field, which would waste the one
 * mechanism that detects real drift.
 */
export const READ_BACK_ATTEMPTS = 7;
/** First gap between attempts; it doubles from here. */
export const READ_BACK_DELAY_MS = 2000;
/**
 * Ceiling on a single gap.
 *
 * Doubling without a cap would spend the whole budget in one long sleep at the
 * end, so a site that settles at forty seconds would still be waited on for
 * over a minute.
 */
export const READ_BACK_MAX_DELAY_MS = 16_000;

export interface ReadBackOutcome extends FingerprintResult {
  /** How many reads it took; 1 means it matched immediately. */
  attempts: number;
}

/**
 * Read the published address back, retrying until it settles.
 *
 * A freshly created deployment is not instantly reachable. Reading once,
 * immediately after publishing, catches the provider mid-propagation and hashes
 * whatever it serves in the meantime — for Cloudflare Pages that is the
 * project's fallback page. This happened in production: a publish recorded a
 * mismatch whose "observed" hash was exactly the placeholder's, while the
 * address served the approved build correctly seconds later.
 *
 * So a non-match is retried before it is believed. A match is returned at once,
 * because a matching hash cannot be a propagation artefact. Exhausting the
 * attempts records the last result honestly rather than giving up into a
 * pretend success.
 *
 * The gap doubles from `delayMs` up to `maxDelayMs`, which spends the budget
 * where propagation actually finishes: most publishes settle in seconds, and
 * the long waits are only reached by the ones that do not. With the defaults
 * that is seven reads over about sixty-two seconds of waiting.
 *
 * **This wait is inside the approval request's transaction**, because the
 * dispatcher records the fingerprint on the row it is about to insert. A
 * publish therefore holds one pooled connection for as long as the read-back
 * runs. That is a real cost, accepted rather than hidden: publishes are
 * approval-gated human actions measured in a handful per day, the pool is ten,
 * and only a publish whose address has NOT settled pays the full budget — a
 * match returns without sleeping at all. If publishing ever becomes frequent
 * or automated, the read-back belongs after the commit instead.
 */
export function backoffDelays(
  attempts: number,
  delayMs: number,
  maxDelayMs: number,
): number[] {
  const gaps: number[] = [];
  let next = delayMs;
  for (let i = 1; i < Math.max(1, attempts); i += 1) {
    gaps.push(Math.min(next, maxDelayMs));
    next *= 2;
  }
  return gaps;
}

export type WithdrawalVerdict = 'withdrawn' | 'still_serving' | 'serving_other' | 'unreadable';

export interface WithdrawalResult {
  verdict: WithdrawalVerdict;
  /** True only when the address demonstrably stopped serving. */
  gone: boolean;
  /** sha256 of whatever the address still serves, when it serves anything. */
  observed: string | null;
  message: string;
}

/**
 * Decide whether a withdrawn address has actually stopped serving.
 *
 * The mirror of `classifyFingerprint`, and it makes the same refusal: an
 * address that could not be read is NOT gone. A withdrawal that fell back to
 * "assume it worked" on a network error would record a site as taken down
 * while it was still public — the more dangerous direction of the two, because
 * the publish read-back at worst reports a problem that is not there, and this
 * one would hide one that is.
 *
 * Bytes that are neither the withdrawn build nor an absence get their own
 * verdict rather than counting as success. The address serving *something
 * else* may be perfectly fine — a sibling site, the project placeholder — but
 * that is a different fact from the site being gone, and only one of them is
 * what a withdrawal claims.
 */
export function classifyWithdrawal(args: {
  /** The build that was live and is being withdrawn. */
  withdrawn: string;
  read: ReadPublicResult | null;
  error?: string | null;
}): WithdrawalResult {
  if (args.read === null) {
    return {
      verdict: 'unreadable',
      gone: false,
      observed: null,
      message: `the withdrawn address could not be read back${args.error ? `: ${args.error}` : ''}, so it is not confirmed gone`,
    };
  }
  if (args.read.status !== 200) {
    return {
      verdict: 'withdrawn',
      gone: true,
      observed: null,
      message: `the withdrawn address answers ${args.read.status} and no longer serves the site`,
    };
  }

  const observed = sha256(args.read.body);
  if (observed === args.withdrawn) {
    return {
      verdict: 'still_serving',
      gone: false,
      observed,
      message:
        'the withdrawn address still serves the build that was taken down; the provider has not applied the withdrawal',
    };
  }
  return {
    verdict: 'serving_other',
    gone: false,
    observed,
    message: `the withdrawn address answers 200 with ${observed.slice(0, 12)}, which is neither the withdrawn build nor an absence`,
  };
}

export interface WithdrawalOutcome extends WithdrawalResult {
  attempts: number;
}

/**
 * Read a withdrawn address back until it stops serving.
 *
 * Propagation runs in both directions. In the 2026-08-04 run a withdrawal that
 * had already committed kept being served for between twenty and forty
 * seconds, and nothing checked it at all: the dispatcher reported "withdrawn"
 * the moment the provider accepted the snapshot. The hourly sweep cannot cover
 * this either, because it only walks deployments that are still `live` — a
 * withdrawn-but-still-serving site is invisible to every other check.
 *
 * `withdrawn` returns at once, because an address that has stopped serving
 * cannot un-stop through propagation. Anything else is retried on the same
 * budget a publish uses, and exhausting it records what was actually observed
 * rather than the outcome that was wanted.
 */
export async function withdrawUntilGone(args: {
  withdrawn: string;
  url: string;
  read: (url: string) => Promise<ReadPublicResult>;
  attempts?: number;
  delayMs?: number;
  maxDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<WithdrawalOutcome> {
  const attempts = Math.max(1, args.attempts ?? READ_BACK_ATTEMPTS);
  const delayMs = args.delayMs ?? READ_BACK_DELAY_MS;
  const maxDelayMs = args.maxDelayMs ?? READ_BACK_MAX_DELAY_MS;
  const sleep = args.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const gaps = backoffDelays(attempts, delayMs, maxDelayMs);

  let last: WithdrawalResult = classifyWithdrawal({ withdrawn: args.withdrawn, read: null });
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const read = await args.read(args.url);
      last = classifyWithdrawal({ withdrawn: args.withdrawn, read });
    } catch (err) {
      last = classifyWithdrawal({
        withdrawn: args.withdrawn,
        read: null,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    if (last.gone) return { ...last, attempts: attempt };
    if (attempt < attempts) await sleep(gaps[attempt - 1] ?? maxDelayMs);
  }
  return { ...last, attempts };
}

export async function readBackUntilSettled(args: {
  approved: string;
  url: string;
  read: (url: string) => Promise<ReadPublicResult>;
  attempts?: number;
  delayMs?: number;
  maxDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<ReadBackOutcome> {
  const attempts = Math.max(1, args.attempts ?? READ_BACK_ATTEMPTS);
  const delayMs = args.delayMs ?? READ_BACK_DELAY_MS;
  const maxDelayMs = args.maxDelayMs ?? READ_BACK_MAX_DELAY_MS;
  const sleep = args.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const gaps = backoffDelays(attempts, delayMs, maxDelayMs);

  let last: FingerprintResult = classifyFingerprint({ approved: args.approved, read: null });
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const read = await args.read(args.url);
      last = classifyFingerprint({ approved: args.approved, read });
    } catch (err) {
      last = classifyFingerprint({
        approved: args.approved,
        read: null,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    if (last.matches) return { ...last, attempts: attempt };
    if (attempt < attempts) await sleep(gaps[attempt - 1] ?? maxDelayMs);
  }
  return { ...last, attempts };
}
