/**
 * Post-publish fingerprint read-back (docs/specs/p2/website-factory.md).
 *
 * Acceptance: "public fingerprint equals approved build". This is the check
 * that measures it instead of asserting it — the 2026-08-03 benchmark found a
 * deployment recorded as `live` carrying a fingerprint nothing had verified.
 */
import { describe, expect, it } from 'vitest';
import { classifyFingerprint, sha256 } from './fingerprint.js';

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
