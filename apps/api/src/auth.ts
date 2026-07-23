/**
 * Request authentication (SECURITY.md §Identity & auth):
 *  - Apps/agents: `Authorization: Bearer <plaintext>` → sha256 → api_tokens
 *    lookup (not disabled) → space + scopes. Tokens NEVER decide approvals.
 *  - Operator: Supabase Auth JWT (HS256, verified against SUPABASE_JWT_SECRET),
 *    email must equal the pinned operator email. Operator always may.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { Db } from './db.js';
import type { Env } from './env.js';

export type AuthContext =
  | { kind: 'operator'; actor: string; spaceId: string | null; scopes: ['*'] }
  | { kind: 'token'; actor: string; spaceId: string; scopes: string[]; tokenId: string }
  /** In-process caller (scheduler worker) — never minted from a request. */
  | { kind: 'system'; actor: string; spaceId: string; scopes: ['*'] };

export class AuthError extends Error {
  constructor(
    public readonly statusCode: 401 | 403,
    message: string,
  ) {
    super(message);
  }
}

export function sha256hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

function b64urlDecode(part: string): Buffer {
  return Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/** Minimal HS256 JWT verify — enough for Supabase Auth access tokens. */
export function verifyOperatorJwt(token: string, env: Env): { email: string } | null {
  const parts = token.split('.');
  if (parts.length !== 3 || !env.supabaseJwtSecret) return null;
  const [headerB64, payloadB64, sigB64] = parts;
  let header: { alg?: string };
  let payload: { email?: string; exp?: number };
  try {
    header = JSON.parse(b64urlDecode(headerB64).toString('utf8')) as { alg?: string };
    payload = JSON.parse(b64urlDecode(payloadB64).toString('utf8')) as { email?: string; exp?: number };
  } catch {
    return null;
  }
  if (header.alg !== 'HS256') return null;
  const expected = createHmac('sha256', env.supabaseJwtSecret).update(`${headerB64}.${payloadB64}`).digest();
  const given = b64urlDecode(sigB64);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  if (typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()) return null;
  if (typeof payload.email !== 'string') return null;
  return { email: payload.email };
}

export interface AuthDeps {
  db: Db;
  env: Env;
}

export async function authenticate(
  authorizationHeader: string | undefined,
  spaceHeader: string | undefined,
  deps: AuthDeps,
): Promise<AuthContext> {
  const raw = authorizationHeader ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(raw);
  if (!match) throw new AuthError(401, 'missing bearer token');
  const bearer = match[1].trim();

  // Operator path: JWTs have exactly two dots and a JSON header.
  if (bearer.split('.').length === 3) {
    const jwt = verifyOperatorJwt(bearer, deps.env);
    if (jwt) {
      if (jwt.email !== deps.env.operatorEmail) throw new AuthError(403, 'not the pinned operator');
      return { kind: 'operator', actor: jwt.email, spaceId: spaceHeader ?? null, scopes: ['*'] };
    }
    // fall through: could be an api token that merely contains dots
  }

  // App/agent token path: sha256 compare against api_tokens.
  const hash = sha256hex(bearer);
  const res = await deps.db.query(
    `select token_id, space_id, label, scopes
       from api_tokens
      where token_hash = $1 and disabled = false
      limit 1`,
    [hash],
  );
  const row = res.rows[0];
  if (!row) throw new AuthError(401, 'unknown or disabled token');

  // best-effort usage stamp; never blocks the request
  void deps.db
    .query('update api_tokens set last_used_at = now() where token_id = $1', [row.token_id])
    .catch(() => undefined);

  return {
    kind: 'token',
    actor: `token:${String(row.label)}`,
    spaceId: String(row.space_id),
    scopes: (row.scopes as string[]) ?? [],
    tokenId: String(row.token_id),
  };
}

/**
 * Scope gate: operator/system always pass. Tokens need one of the
 * capability's scopes; a capability with NO scopes is operator-only
 * (approvals.decide, memory.distill, playbooks.author, …).
 */
export function checkScopes(auth: AuthContext, capabilityScopes: string[]): void {
  if (auth.kind === 'operator' || auth.kind === 'system') return;
  if (capabilityScopes.length === 0) throw new AuthError(403, 'operator-only capability');
  if (!capabilityScopes.some((s) => auth.scopes.includes(s))) {
    throw new AuthError(403, `token lacks required scope (needs one of: ${capabilityScopes.join(', ')})`);
  }
}
