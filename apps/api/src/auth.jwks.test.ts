/** ES256 operator-token verification via JWKS (Supabase JWT Signing Keys). */
import { describe, it, expect, beforeEach } from 'vitest';
import { generateKeyPairSync, createSign, randomUUID, type KeyObject } from 'node:crypto';
import { verifyOperatorJwt } from './auth.js';
import { _clearJwksCache, type Fetcher } from './jwks.js';
import { loadEnv, type Env } from './env.js';

const b64url = (b: Buffer): string =>
  b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function makeEnv(): Env {
  return loadEnv({
    SUPABASE_URL: 'https://proj.supabase.co',
    OPERATOR_EMAIL: 'op@test.local',
    DATABASE_URL: 'postgres://unused',
  } as NodeJS.ProcessEnv);
}

/** Sign an ES256 JWT and return { token, jwk } for a published JWKS. */
function mintEs256(kid: string, payload: Record<string, unknown>): { token: string; publicJwk: JsonWebKey } {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const header = b64url(Buffer.from(JSON.stringify({ alg: 'ES256', typ: 'JWT', kid })));
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  const signer = createSign('sha256').update(`${header}.${body}`);
  signer.end();
  // JWT wants raw r||s, not DER:
  const sig = signer.sign({ key: privateKey as KeyObject, dsaEncoding: 'ieee-p1363' });
  const publicJwk = publicKey.export({ format: 'jwk' }) as JsonWebKey;
  (publicJwk as Record<string, unknown>).kid = kid;
  (publicJwk as Record<string, unknown>).alg = 'ES256';
  return { token: `${header}.${body}.${b64url(sig)}`, publicJwk };
}

function fetcherFor(keys: JsonWebKey[]): Fetcher {
  return async () => ({ ok: true, json: async () => ({ keys }) });
}

describe('verifyOperatorJwt — ES256 via JWKS', () => {
  beforeEach(() => _clearJwksCache());

  it('accepts a valid ES256 operator token signed by a published JWKS key', async () => {
    const kid = randomUUID();
    const { token, publicJwk } = mintEs256(kid, { email: 'op@test.local', exp: Math.floor(Date.now() / 1000) + 3600 });
    const res = await verifyOperatorJwt(token, makeEnv(), fetcherFor([publicJwk]));
    expect(res).toEqual({ email: 'op@test.local' });
  });

  it('rejects when the kid is not in the JWKS', async () => {
    const { token } = mintEs256(randomUUID(), { email: 'op@test.local', exp: Math.floor(Date.now() / 1000) + 3600 });
    const other = mintEs256(randomUUID(), { email: 'x' }); // a different key gets published
    const res = await verifyOperatorJwt(token, makeEnv(), fetcherFor([other.publicJwk]));
    expect(res).toBeNull();
  });

  it('rejects a tampered payload (signature no longer matches)', async () => {
    const kid = randomUUID();
    const { token, publicJwk } = mintEs256(kid, { email: 'op@test.local', exp: Math.floor(Date.now() / 1000) + 3600 });
    const [h, , s] = token.split('.');
    const forged = b64url(Buffer.from(JSON.stringify({ email: 'attacker@evil.com', exp: Math.floor(Date.now() / 1000) + 3600 })));
    const res = await verifyOperatorJwt(`${h}.${forged}.${s}`, makeEnv(), fetcherFor([publicJwk]));
    expect(res).toBeNull();
  });

  it('rejects an expired ES256 token even if the signature is valid', async () => {
    const kid = randomUUID();
    const { token, publicJwk } = mintEs256(kid, { email: 'op@test.local', exp: Math.floor(Date.now() / 1000) - 10 });
    const res = await verifyOperatorJwt(token, makeEnv(), fetcherFor([publicJwk]));
    expect(res).toBeNull();
  });

  it('still accepts a legacy HS256 token (test harness path)', async () => {
    const env = loadEnv({
      SUPABASE_URL: 'https://proj.supabase.co',
      SUPABASE_JWT_SECRET: 'legacy-secret',
      OPERATOR_EMAIL: 'op@test.local',
      DATABASE_URL: 'postgres://unused',
    } as NodeJS.ProcessEnv);
    const { createHmac } = await import('node:crypto');
    const header = b64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
    const body = b64url(Buffer.from(JSON.stringify({ email: 'op@test.local', exp: Math.floor(Date.now() / 1000) + 3600 })));
    const sig = b64url(createHmac('sha256', 'legacy-secret').update(`${header}.${body}`).digest());
    const res = await verifyOperatorJwt(`${header}.${body}.${sig}`, env);
    expect(res).toEqual({ email: 'op@test.local' });
  });
});
