/**
 * Stale-bundle detection.
 *
 * `index.html` is served without a Cache-Control header, so a browser may keep
 * serving a cached copy that points at an old hashed asset. The page then runs
 * indefinitely-old code against a current API, which surfaces as puzzling
 * failures rather than an obvious "you are out of date" — it cost a long
 * debugging detour once already.
 *
 * The page therefore checks the deployment fingerprint it was built from
 * against the one the server is publishing now.
 */

/** Fingerprint file written at build time by scripts/write-build-info.cjs. */
export const BUILD_INFO_PATH = '/build-info.json';

/**
 * True only when both commits are known and differ. An unknown on either side
 * means "cannot tell", which must never be reported as stale: nagging a user
 * to reload on every load would be worse than the problem.
 */
export function isStale(bundleSha: string, liveSha: string | null | undefined): boolean {
  if (!liveSha || liveSha === 'unknown') return false;
  if (!bundleSha || bundleSha === 'unknown') return false;
  return bundleSha !== liveSha;
}

type FetchLike = (input: string, init?: { cache?: RequestCache }) => Promise<{
  ok: boolean;
  json: () => Promise<unknown>;
}>;

/**
 * Read the currently published commit. Cache-busted deliberately: the whole
 * point is defeated if this response is itself served from cache.
 */
export async function fetchLiveSha(
  fetchImpl: FetchLike = ((input, init) => fetch(input, init)) as FetchLike,
  now: () => number = Date.now,
): Promise<string | null> {
  try {
    const res = await fetchImpl(`${BUILD_INFO_PATH}?ts=${now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const body = (await res.json()) as { gitSha?: unknown };
    return typeof body.gitSha === 'string' && body.gitSha.trim() !== '' ? body.gitSha : null;
  } catch {
    // Offline or blocked: silence is correct. This check must never break the app.
    return null;
  }
}
