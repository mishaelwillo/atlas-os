import { describe, expect, it } from 'vitest';
import type { Session } from '@supabase/supabase-js';
import {
  LEGACY_TOKEN_KEY,
  SPACE_KEY,
  SIGNED_OUT,
  clearLegacyToken,
  readStoredSpace,
  readSupabaseConfig,
  toOperatorSession,
  writeStoredSpace,
} from './session.js';

const OPERATOR = 'operator@example.com';

function sessionFor(email: string | null, accessToken = 'header.payload.signature'): Session {
  return {
    access_token: accessToken,
    user: email === null ? undefined : { email },
  } as unknown as Session;
}

describe('operator session mapping', () => {
  it('treats a missing session as signed out', () => {
    expect(toOperatorSession(null, OPERATOR)).toEqual(SIGNED_OUT);
  });

  it('admits the pinned operator and exposes the access token', () => {
    const result = toOperatorSession(sessionFor(OPERATOR), OPERATOR);
    expect(result.status).toBe('signed_in');
    expect(result.accessToken).toBe('header.payload.signature');
    expect(result.error).toBeNull();
  });

  it('ignores email casing, which is not meaningful for identity', () => {
    expect(toOperatorSession(sessionFor('Operator@Example.COM'), OPERATOR).status).toBe(
      'signed_in',
    );
  });

  /**
   * A valid non-operator account is a policy outcome, not a typo. Surfacing it
   * here avoids the operator discovering it later as an opaque 401.
   */
  it('refuses a valid session for any other address and withholds the token', () => {
    const result = toOperatorSession(sessionFor('someone-else@example.com'), OPERATOR);
    expect(result.status).toBe('not_operator');
    expect(result.accessToken).toBeNull();
    expect(result.error).toMatch(/not the pinned operator/);
  });

  it('refuses a session that carries no email at all', () => {
    const result = toOperatorSession(sessionFor(null), OPERATOR);
    expect(result.status).toBe('not_operator');
    expect(result.accessToken).toBeNull();
  });

  it('treats an empty access token as signed out rather than authorized', () => {
    expect(toOperatorSession(sessionFor(OPERATOR, ''), OPERATOR)).toEqual(SIGNED_OUT);
  });
});

describe('supabase configuration', () => {
  it('returns null when identity is not configured', () => {
    expect(readSupabaseConfig({})).toBeNull();
    expect(readSupabaseConfig({ VITE_SUPABASE_URL: 'https://x.supabase.co' })).toBeNull();
    expect(readSupabaseConfig({ VITE_SUPABASE_ANON_KEY: 'anon' })).toBeNull();
  });

  it('rejects blank values rather than constructing an unusable client', () => {
    expect(
      readSupabaseConfig({ VITE_SUPABASE_URL: '   ', VITE_SUPABASE_ANON_KEY: 'anon' }),
    ).toBeNull();
  });

  it('reads a configured pair', () => {
    expect(
      readSupabaseConfig({
        VITE_SUPABASE_URL: ' https://x.supabase.co ',
        VITE_SUPABASE_ANON_KEY: ' anon ',
      }),
    ).toEqual({ url: 'https://x.supabase.co', anonKey: 'anon' });
  });
});

describe('stored client state', () => {
  function fakeStorage(initial: Record<string, string> = {}) {
    const map = new Map(Object.entries(initial));
    return {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
      has: (k: string) => map.has(k),
    };
  }

  it('clears the pre-session credential so it cannot outlive the upgrade', () => {
    const storage = fakeStorage({ [LEGACY_TOKEN_KEY]: 'stale-pasted-value' });
    clearLegacyToken(storage);
    expect(storage.has(LEGACY_TOKEN_KEY)).toBe(false);
  });

  it('round-trips the selected space and treats blank as absent', () => {
    const storage = fakeStorage();
    expect(readStoredSpace(storage)).toBeNull();

    writeStoredSpace(storage, 'space-uuid');
    expect(readStoredSpace(storage)).toBe('space-uuid');

    writeStoredSpace(storage, null);
    expect(storage.has(SPACE_KEY)).toBe(false);

    storage.setItem(SPACE_KEY, '   ');
    expect(readStoredSpace(storage)).toBeNull();
  });
});
