/**
 * Operator session (docs/specs/p2/operator-sign-in.md).
 *
 * Supabase Auth is the identity source; `is_operator()` and the API's pinned
 * operator email are the authority on whether that identity may act. A session
 * for any other address authenticates successfully here and is still refused
 * by every policy, so this module reports that case explicitly rather than
 * letting the operator discover it as an opaque 401 later.
 */
import { createClient, type SupabaseClient, type Session } from '@supabase/supabase-js';

/** Pre-session key that held a hand-pasted credential. Cleared on upgrade. */
export const LEGACY_TOKEN_KEY = 'atlas.token';
export const SPACE_KEY = 'atlas.spaceId';

export type SessionStatus =
  | 'loading'
  | 'signed_out'
  | 'authenticating'
  | 'signed_in'
  | 'not_operator'
  | 'unavailable';

export interface OperatorSession {
  status: SessionStatus;
  email: string | null;
  accessToken: string | null;
  error: string | null;
}

export const SIGNED_OUT: OperatorSession = {
  status: 'signed_out',
  email: null,
  accessToken: null,
  error: null,
};

interface SupabaseConfig {
  url: string;
  anonKey: string;
}

export function readSupabaseConfig(
  env: Record<string, string | undefined>,
): SupabaseConfig | null {
  const url = env.VITE_SUPABASE_URL?.trim();
  const anonKey = env.VITE_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

let cached: SupabaseClient | null = null;

/** Null when the build has no Supabase identity configured. */
export function getSupabase(
  env: Record<string, string | undefined> = import.meta.env as unknown as Record<
    string,
    string | undefined
  >,
): SupabaseClient | null {
  if (cached) return cached;
  const config = readSupabaseConfig(env);
  if (!config) return null;
  cached = createClient(config.url, config.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  return cached;
}

/** Test seam: drop the memoized client between cases. */
export function resetSupabaseForTests(): void {
  cached = null;
}

/**
 * Map a Supabase session onto operator state. The pinned address is compared
 * case-insensitively because email casing is not meaningful, while the policy
 * comparison in `is_operator()` is exact — so anything that would fail there
 * must be surfaced here rather than silently allowed through.
 */
export function toOperatorSession(
  session: Session | null,
  operatorEmail: string,
): OperatorSession {
  if (!session?.access_token) return SIGNED_OUT;
  const email = session.user?.email ?? null;
  if (!email || email.toLowerCase() !== operatorEmail.toLowerCase()) {
    return {
      status: 'not_operator',
      email,
      accessToken: null,
      error: `Signed in as ${email ?? 'an unknown account'}, which is not the pinned operator.`,
    };
  }
  return { status: 'signed_in', email, accessToken: session.access_token, error: null };
}

/**
 * Remove the pre-session credential so a stale pasted value cannot outlive the
 * upgrade and keep granting access.
 */
export function clearLegacyToken(storage: Pick<Storage, 'removeItem'>): void {
  storage.removeItem(LEGACY_TOKEN_KEY);
}

export function readStoredSpace(storage: Pick<Storage, 'getItem'>): string | null {
  const value = storage.getItem(SPACE_KEY);
  return value && value.trim() !== '' ? value : null;
}

export function writeStoredSpace(
  storage: Pick<Storage, 'setItem' | 'removeItem'>,
  spaceId: string | null,
): void {
  if (spaceId) storage.setItem(SPACE_KEY, spaceId);
  else storage.removeItem(SPACE_KEY);
}

export interface SpaceOption {
  spaceId: string;
  slug: string;
  name: string;
}

/**
 * Spaces are read directly under the operator session; `spaces_operator` RLS
 * restricts the rows. A registry capability for this is deferred (see spec).
 */
export async function listSpaces(client: SupabaseClient): Promise<SpaceOption[]> {
  const { data, error } = await client
    .from('spaces')
    .select('space_id, slug, name')
    .order('slug');
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    spaceId: String((row as Record<string, unknown>).space_id),
    slug: String((row as Record<string, unknown>).slug),
    name: String((row as Record<string, unknown>).name),
  }));
}
