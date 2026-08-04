/**
 * Post-publish fingerprint read-back (docs/specs/p2/website-factory.md).
 *
 * Acceptance: "public fingerprint equals approved build". This is the check
 * that measures it instead of asserting it — the 2026-08-03 benchmark found a
 * deployment recorded as `live` carrying a fingerprint nothing had verified.
 */
import { describe, expect, it } from 'vitest';
import { classifyFingerprint, readBackUntilSettled, sha256 } from './fingerprint.js';

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
    // Waits between attempts, not after the last one.
    expect(waits).toEqual([1500, 1500]);
  });
});
