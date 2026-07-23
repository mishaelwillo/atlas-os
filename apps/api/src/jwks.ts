/**
 * JWKS verification for Supabase "JWT Signing Keys" (asymmetric operator
 * tokens). Supabase publishes EC/RSA public keys at
 *   <supabaseUrl>/auth/v1/.well-known/jwks.json
 * and signs access tokens with ES256 (default) or RS256. We verify with
 * Node's built-in crypto — no external JWT/JWKS dependency (brief §Style).
 *
 * Keys are cached in-process with a TTL; an unknown `kid` forces one refetch
 * (handles key rotation) before giving up.
 */
import { createPublicKey, verify, type JsonWebKey } from 'node:crypto';

interface Jwk extends JsonWebKey {
  kid?: string;
  alg?: string;
}

interface CacheEntry {
  keys: Map<string, Jwk>;
  fetchedAt: number;
}

const TTL_MS = 10 * 60 * 1000; // 10 min
const cacheByUrl = new Map<string, CacheEntry>();

/** Injectable for tests; defaults to global fetch. */
export type Fetcher = (url: string) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

async function loadKeys(jwksUrl: string, fetcher: Fetcher): Promise<Map<string, Jwk> | null> {
  try {
    const res = await fetcher(jwksUrl);
    if (!res.ok) return null;
    const body = (await res.json()) as { keys?: Jwk[] };
    const map = new Map<string, Jwk>();
    for (const k of body.keys ?? []) {
      if (typeof k.kid === 'string') map.set(k.kid, k);
    }
    cacheByUrl.set(jwksUrl, { keys: map, fetchedAt: Date.now() });
    return map;
  } catch {
    return null;
  }
}

async function getSigningKey(jwksUrl: string, kid: string, fetcher: Fetcher): Promise<Jwk | null> {
  const cached = cacheByUrl.get(jwksUrl);
  const fresh = cached && Date.now() - cached.fetchedAt < TTL_MS;
  if (fresh && cached.keys.has(kid)) return cached.keys.get(kid) ?? null;
  // Stale, missing, or unknown kid (possible rotation): (re)fetch once.
  const keys = await loadKeys(jwksUrl, fetcher);
  if (keys) return keys.get(kid) ?? null;
  // Network failure: fall back to any cached copy so we don't hard-fail on a blip.
  return cached?.keys.get(kid) ?? null;
}

export function jwksUrlFor(supabaseUrl: string): string {
  return `${supabaseUrl.replace(/\/+$/, '')}/auth/v1/.well-known/jwks.json`;
}

/**
 * Verify an ES256/RS256 JWT signature against the project's JWKS.
 * `signingInput` is `${headerB64}.${payloadB64}`; `signature` is the raw
 * (base64url-decoded) JWT signature bytes.
 */
export async function verifyJwksSignature(args: {
  supabaseUrl: string;
  alg: string;
  kid: string;
  signingInput: string;
  signature: Buffer;
  fetcher?: Fetcher;
}): Promise<boolean> {
  const { supabaseUrl, alg, kid, signingInput, signature } = args;
  if (!supabaseUrl || !kid) return false;
  if (alg !== 'ES256' && alg !== 'RS256') return false;

  const fetcher: Fetcher = args.fetcher ?? ((url) => fetch(url));
  const jwk = await getSigningKey(jwksUrlFor(supabaseUrl), kid, fetcher);
  if (!jwk) return false;

  let keyObject;
  try {
    keyObject = createPublicKey({ key: jwk, format: 'jwk' });
  } catch {
    return false;
  }

  const data = Buffer.from(signingInput);
  try {
    if (alg === 'ES256') {
      // JWT ECDSA signatures are raw r||s (IEEE P1363), not DER.
      return verify('sha256', data, { key: keyObject, dsaEncoding: 'ieee-p1363' }, signature);
    }
    return verify('sha256', data, keyObject, signature); // RS256
  } catch {
    return false;
  }
}

/** Test-only: drop cached keys so a test starts clean. */
export function _clearJwksCache(): void {
  cacheByUrl.clear();
}
