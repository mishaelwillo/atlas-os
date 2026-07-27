/**
 * Operator sign-in view (docs/specs/p2/operator-sign-in.md).
 * The password is passed straight to Supabase Auth and is never stored,
 * logged, or held in state beyond the in-flight submit.
 */
import React, { useState } from 'react';
import styles from './MissionControl.module.css';

export interface SignInProps {
  onSubmit: (email: string, password: string) => Promise<void>;
  status: 'signed_out' | 'authenticating' | 'not_operator' | 'unavailable';
  error: string | null;
}

export function SignIn({ onSubmit, status, error }: SignInProps): React.ReactElement {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const busy = status === 'authenticating';

  if (status === 'unavailable') {
    return (
      <div className={styles.signIn}>
        <h2>Identity unavailable</h2>
        <p className={styles.error}>
          This build has no Supabase identity configured, so operator sign-in cannot run.
          Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY and rebuild.
        </p>
      </div>
    );
  }

  return (
    <form
      className={styles.signIn}
      onSubmit={(e) => {
        e.preventDefault();
        if (busy) return;
        const submitted = password;
        setPassword('');
        void onSubmit(email.trim(), submitted);
      }}
    >
      <h2>Operator sign-in</h2>
      <label className={styles.field}>
        <span>Email</span>
        <input
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={busy}
          required
        />
      </label>
      <label className={styles.field}>
        <span>Password</span>
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={busy}
          required
        />
      </label>
      <button type="submit" disabled={busy}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
