import { describe, expect, it, vi } from 'vitest';
import { fetchLiveSha, isStale } from './staleness.js';

describe('isStale', () => {
  it('detects a bundle built from a different commit', () => {
    expect(isStale('aaaa111', 'bbbb222')).toBe(true);
  });

  it('reports a matching commit as current', () => {
    expect(isStale('aaaa111', 'aaaa111')).toBe(false);
  });

  /**
   * "Cannot tell" must never render as "stale" — a false reload prompt on
   * every load would be worse than the staleness it warns about.
   */
  it.each([
    ['live unavailable', 'aaaa111', null],
    ['live unknown', 'aaaa111', 'unknown'],
    ['bundle unknown', 'unknown', 'bbbb222'],
    ['both unknown', 'unknown', 'unknown'],
    ['bundle empty', '', 'bbbb222'],
  ])('stays quiet when %s', (_name, bundle, live) => {
    expect(isStale(bundle, live as string | null)).toBe(false);
  });
});

describe('fetchLiveSha', () => {
  it('cache-busts the request, or the check reads its own stale copy', async () => {
    const calls: Array<{ url: string; init?: { cache?: RequestCache } }> = [];
    const fetchImpl = vi.fn(async (url: string, init?: { cache?: RequestCache }) => {
      calls.push({ url, init });
      return { ok: true, json: async () => ({ gitSha: 'bbbb222' }) };
    });

    const sha = await fetchLiveSha(fetchImpl, () => 12345);

    expect(sha).toBe('bbbb222');
    expect(calls[0].url).toBe('/build-info.json?ts=12345');
    expect(calls[0].init?.cache).toBe('no-store');
  });

  it('returns null on a non-ok response', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, json: async () => ({}) }));
    expect(await fetchLiveSha(fetchImpl)).toBeNull();
  });

  /** This check is a convenience; it must never break the app. */
  it('returns null when the request throws', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('offline');
    });
    expect(await fetchLiveSha(fetchImpl)).toBeNull();
  });

  it('returns null when the payload carries no usable commit', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ gitSha: '   ' }) }));
    expect(await fetchLiveSha(fetchImpl)).toBeNull();
  });
});
