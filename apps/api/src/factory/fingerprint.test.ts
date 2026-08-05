/**
 * Post-publish fingerprint read-back (docs/specs/p2/website-factory.md).
 *
 * Acceptance: "public fingerprint equals approved build". This is the check
 * that measures it instead of asserting it — the 2026-08-03 benchmark found a
 * deployment recorded as `live` carrying a fingerprint nothing had verified.
 */
import { describe, expect, it } from 'vitest';
import {
  READ_BACK_ATTEMPTS,
  READ_BACK_DELAY_MS,
  READ_BACK_MAX_DELAY_MS,
  backoffDelays,
  classifyFingerprint,
  classifyWithdrawal,
  readBackUntilSettled,
  sha256,
  withdrawUntilGone,
} from './fingerprint.js';

const HTML = '<!doctype html>\n<html lang="en"><body>Acme</body></html>\n';
const APPROVED = sha256(HTML);

describe('classifyFingerprint', () => {
  it('matches when the public address serves exactly the approved build', () => {
    const result = classifyFingerprint({ approved: APPROVED, read: { status: 200, body: HTML } });
    expect(result).toMatchObject({ verdict: 'match', matches: true, observed: APPROVED });
  });

  /**
   * The real case: the origin served the approved bytes while the edge injected
   * a script, so the reader received something nobody approved.
   */
  it('reports a mismatch when the bytes were changed in transit', () => {
    const injected = HTML.replace('</body>', '<script>/* injected */</script></body>');
    const result = classifyFingerprint({ approved: APPROVED, read: { status: 200, body: injected } });

    expect(result.verdict).toBe('mismatch');
    expect(result.matches).toBe(false);
    expect(result.observed).toBe(sha256(injected));
    expect(result.observed).not.toBe(APPROVED);
    expect(result.message).toContain(APPROVED.slice(0, 12));
  });

  it('notices a single changed byte', () => {
    const result = classifyFingerprint({
      approved: APPROVED,
      read: { status: 200, body: HTML.replace('Acme', 'Acmf') },
    });
    expect(result.matches).toBe(false);
  });

  /**
   * An unreadable address is not a match. Falling back to "assume fine" would
   * leave the row carrying a verified-looking fingerprint nothing verified,
   * which is worse than having no read-back.
   */
  it('treats an unreachable address as unreadable, never as a match', () => {
    const result = classifyFingerprint({
      approved: APPROVED,
      read: null,
      error: 'getaddrinfo ENOTFOUND',
    });
    expect(result).toMatchObject({ verdict: 'unreadable', matches: false, observed: null });
    expect(result.message).toContain('ENOTFOUND');
  });

  it('treats a non-200 as unreadable and says what it answered', () => {
    for (const status of [404, 500, 301]) {
      const result = classifyFingerprint({ approved: APPROVED, read: { status, body: 'nope' } });
      expect(result).toMatchObject({ verdict: 'unreadable', matches: false, observed: null });
      expect(result.message).toContain(String(status));
    }
  });

  it('never reports matches true unless the digests are equal', () => {
    const cases = [
      classifyFingerprint({ approved: APPROVED, read: null }),
      classifyFingerprint({ approved: APPROVED, read: { status: 500, body: HTML } }),
      classifyFingerprint({ approved: APPROVED, read: { status: 200, body: `${HTML} ` } }),
    ];
    expect(cases.every((c) => c.matches === false)).toBe(true);
  });
});

describe('sha256', () => {
  it('is the same digest the renderer produces for the same bytes', () => {
    expect(sha256(HTML)).toBe(APPROVED);
    expect(sha256(HTML)).toMatch(/^[0-9a-f]{64}$/);
  });
});

/**
 * A freshly created deployment is not instantly reachable. Reading once,
 * immediately after publishing, catches the provider mid-propagation — in
 * production that recorded a mismatch whose observed hash was exactly the
 * Pages placeholder's, while the address served the approved build seconds
 * later.
 */
describe('readBackUntilSettled', () => {
  const never = async () => undefined;

  it('returns at once when the first read matches', async () => {
    let reads = 0;
    const out = await readBackUntilSettled({
      approved: APPROVED,
      url: 'https://x/a',
      read: async () => {
        reads += 1;
        return { status: 200, body: HTML };
      },
      sleep: never,
    });
    expect(out).toMatchObject({ verdict: 'match', attempts: 1 });
    expect(reads).toBe(1);
  });

  /** The real case: the placeholder first, the build once it propagates. */
  it('keeps reading until the address serves the approved build', async () => {
    let reads = 0;
    const out = await readBackUntilSettled({
      approved: APPROVED,
      url: 'https://x/a',
      read: async () => {
        reads += 1;
        return reads < 3 ? { status: 200, body: '<html>placeholder</html>' } : { status: 200, body: HTML };
      },
      sleep: never,
    });
    expect(out).toMatchObject({ verdict: 'match', attempts: 3 });
  });

  it('retries a 404 while the deployment is still landing', async () => {
    let reads = 0;
    const out = await readBackUntilSettled({
      approved: APPROVED,
      url: 'https://x/a',
      read: async () => {
        reads += 1;
        return reads < 2 ? { status: 404, body: '' } : { status: 200, body: HTML };
      },
      sleep: never,
    });
    expect(out).toMatchObject({ verdict: 'match', attempts: 2 });
  });

  /** A genuine mismatch is still a mismatch once the attempts are spent. */
  it('believes a mismatch that never settles', async () => {
    const injected = `${HTML}<script></script>`;
    const out = await readBackUntilSettled({
      approved: APPROVED,
      url: 'https://x/a',
      read: async () => ({ status: 200, body: injected }),
      attempts: 3,
      sleep: never,
    });
    expect(out).toMatchObject({ verdict: 'mismatch', attempts: 3 });
    expect(out.observed).toBe(sha256(injected));
  });

  /** Exhausting attempts must not turn into a pretend success. */
  it('reports unreadable rather than passing when nothing ever answers', async () => {
    const out = await readBackUntilSettled({
      approved: APPROVED,
      url: 'https://x/a',
      read: async () => {
        throw new Error('ECONNRESET');
      },
      attempts: 2,
      sleep: never,
    });
    expect(out).toMatchObject({ verdict: 'unreadable', matches: false, attempts: 2 });
  });

  it('waits between attempts', async () => {
    const waits: number[] = [];
    await readBackUntilSettled({
      approved: APPROVED,
      url: 'https://x/a',
      read: async () => ({ status: 404, body: '' }),
      attempts: 3,
      delayMs: 1500,
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    // Waits between attempts, not after the last one. The gap doubles.
    expect(waits).toEqual([1500, 3000]);
  });

  it('doubles the gap and stops doubling at the ceiling', async () => {
    const waits: number[] = [];
    await readBackUntilSettled({
      approved: APPROVED,
      url: 'https://x/a',
      read: async () => ({ status: 404, body: '' }),
      attempts: 6,
      delayMs: 2000,
      maxDelayMs: 8000,
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    expect(waits).toEqual([2000, 4000, 8000, 8000, 8000]);
  });

  /** A settled address must never pay for the budget. */
  it('does not wait at all when the first read matches', async () => {
    const waits: number[] = [];
    await readBackUntilSettled({
      approved: APPROVED,
      url: 'https://x/a',
      read: async () => ({ status: 200, body: HTML }),
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    expect(waits).toEqual([]);
  });
});

/**
 * The shipped budget, asserted rather than described.
 *
 * Ten seconds was too short: the 2026-08-04 loop run recorded a `mismatch` on
 * two of three publishes for addresses that were serving the approved build
 * within a minute. These pin what the defaults actually spend, so shortening
 * them again has to be a deliberate decision rather than a number that quietly
 * drifts back.
 */
describe('the shipped read-back budget', () => {
  it('waits about a minute across seven reads', () => {
    const gaps = backoffDelays(READ_BACK_ATTEMPTS, READ_BACK_DELAY_MS, READ_BACK_MAX_DELAY_MS);
    expect(gaps).toEqual([2000, 4000, 8000, 16000, 16000, 16000]);

    const totalMs = gaps.reduce((a, b) => a + b, 0);
    expect(totalMs).toBe(62_000);
    // Comfortably past the settling time observed in production, and bounded
    // well short of anything that would look like a hung request.
    expect(totalMs).toBeGreaterThan(45_000);
    expect(totalMs).toBeLessThan(120_000);
  });

  it('never waits longer than the ceiling in one go', () => {
    const gaps = backoffDelays(20, READ_BACK_DELAY_MS, READ_BACK_MAX_DELAY_MS);
    expect(Math.max(...gaps)).toBe(READ_BACK_MAX_DELAY_MS);
  });
});

/**
 * Withdrawal propagates too, and until this existed nothing checked it: the
 * dispatcher reported "withdrawn" the moment the provider accepted the
 * snapshot, while the address kept serving for twenty to forty seconds in
 * production. The hourly sweep cannot cover it either — it only walks
 * deployments that are still `live`.
 */
describe('classifyWithdrawal', () => {
  it('treats a non-200 as gone', () => {
    const result = classifyWithdrawal({ withdrawn: APPROVED, read: { status: 404, body: '' } });
    expect(result).toMatchObject({ verdict: 'withdrawn', gone: true, observed: null });
  });

  it('reports the withdrawn build still being served', () => {
    const result = classifyWithdrawal({ withdrawn: APPROVED, read: { status: 200, body: HTML } });
    expect(result).toMatchObject({ verdict: 'still_serving', gone: false, observed: APPROVED });
    expect(result.message).toMatch(/has not applied the withdrawal/);
  });

  /** Other bytes may be fine, but that is not the same fact as being gone. */
  it('does not count other bytes at the address as a withdrawal', () => {
    const result = classifyWithdrawal({
      withdrawn: APPROVED,
      read: { status: 200, body: '<html>placeholder</html>' },
    });
    expect(result.verdict).toBe('serving_other');
    expect(result.gone).toBe(false);
  });

  /**
   * The refusal that matters most, and the opposite direction from the publish
   * read-back: assuming a withdrawal worked because the address could not be
   * read would record a site as taken down while it was still public.
   */
  it('refuses to call an unreadable address gone', () => {
    const result = classifyWithdrawal({ withdrawn: APPROVED, read: null, error: 'ECONNRESET' });
    expect(result).toMatchObject({ verdict: 'unreadable', gone: false });
    expect(result.message).toMatch(/not confirmed gone/);
  });
});

describe('withdrawUntilGone', () => {
  const never = async () => undefined;

  it('returns at once when the address has already stopped serving', async () => {
    let reads = 0;
    const out = await withdrawUntilGone({
      withdrawn: APPROVED,
      url: 'https://x/a',
      read: async () => {
        reads += 1;
        return { status: 404, body: '' };
      },
      sleep: never,
    });
    expect(out).toMatchObject({ verdict: 'withdrawn', gone: true, attempts: 1 });
    expect(reads).toBe(1);
  });

  /** The observed production case: still served, then gone. */
  it('keeps reading while the withdrawal is still propagating', async () => {
    let reads = 0;
    const out = await withdrawUntilGone({
      withdrawn: APPROVED,
      url: 'https://x/a',
      read: async () => {
        reads += 1;
        return reads < 3 ? { status: 200, body: HTML } : { status: 404, body: '' };
      },
      sleep: never,
    });
    expect(out).toMatchObject({ verdict: 'withdrawn', gone: true, attempts: 3 });
  });

  /** Exhausting the budget must report what is true, not what was wanted. */
  it('reports a withdrawal that never took effect', async () => {
    const out = await withdrawUntilGone({
      withdrawn: APPROVED,
      url: 'https://x/a',
      read: async () => ({ status: 200, body: HTML }),
      attempts: 3,
      sleep: never,
    });
    expect(out).toMatchObject({ verdict: 'still_serving', gone: false, attempts: 3 });
  });

  it('never reports gone when the address cannot be read at all', async () => {
    const out = await withdrawUntilGone({
      withdrawn: APPROVED,
      url: 'https://x/a',
      read: async () => {
        throw new Error('ECONNRESET');
      },
      attempts: 2,
      sleep: never,
    });
    expect(out).toMatchObject({ verdict: 'unreadable', gone: false, attempts: 2 });
  });

  it('spends the same budget a publish does', async () => {
    const waits: number[] = [];
    await withdrawUntilGone({
      withdrawn: APPROVED,
      url: 'https://x/a',
      read: async () => ({ status: 200, body: HTML }),
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    expect(waits).toEqual(
      backoffDelays(READ_BACK_ATTEMPTS, READ_BACK_DELAY_MS, READ_BACK_MAX_DELAY_MS),
    );
  });
});
