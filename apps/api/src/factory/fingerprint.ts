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
