/**
 * Regression: a password manager autofilled the masked "act as a scoped API
 * token" field with the operator's password. That value silently replaced the
 * session token and was transmitted as the bearer on every request.
 *
 * The override must therefore be inert unless switched on deliberately, and
 * the field must not attract credential autofill.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MissionControlLive } from './MissionControl.js';

declare global {
  var __atlasClientOptions: { token?: string } | undefined;
}

/** Capture what the app hands the client, which is what gets sent as bearer. */
vi.mock('@atlas/client', () => ({
  createGeneratedClient: (opts: { token?: string }) => {
    globalThis.__atlasClientOptions = opts;
    return {
      statusMissionControl: async () => ({
        ok: true,
        generatedAt: new Date().toISOString(),
        cards: [],
      }),
    };
  },
}));

vi.mock('./session.js', async () => {
  const actual = await vi.importActual<typeof import('./session.js')>('./session.js');
  return {
    ...actual,
    getSupabase: () => ({
      auth: {
        getSession: async () => ({
          data: {
            session: {
              access_token: 'header.payload.signature',
              user: { email: 'mobiledynamic876@gmail.com' },
            },
          },
        }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
        signOut: async () => undefined,
      },
      from: () => ({ select: () => ({ order: async () => ({ data: [], error: null }) }) }),
    }),
  };
});

async function signedIn() {
  render(<MissionControlLive />);
  return screen.findByTestId('override-enabled');
}

describe('scoped-token override', () => {
  it('is off by default, so there is no field for autofill to populate', async () => {
    const toggle = await signedIn();
    expect((toggle as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByTestId('override-token')).toBeNull();
  });

  /** The session token must reach the client while the override is off. */
  it('sends the operator session token by default', async () => {
    await signedIn();
    await waitFor(() =>
      expect(globalThis.__atlasClientOptions?.token).toBe('header.payload.signature'),
    );
  });

  it('marks the field so a password manager will not offer the saved password', async () => {
    const toggle = await signedIn();
    await userEvent.click(toggle);

    const field = screen.getByTestId('override-token');
    expect(field.getAttribute('autocomplete')).toBe('new-password');
    expect(field.getAttribute('name')).toBe('atlas-diagnostic-token');
  });

  it('applies the override only once switched on', async () => {
    const toggle = await signedIn();
    await userEvent.click(toggle);
    await userEvent.type(screen.getByTestId('override-token'), 'atlas_tok_123');

    await waitFor(() => expect(globalThis.__atlasClientOptions?.token).toBe('atlas_tok_123'));
  });

  /** Switching off must restore the session, not leave a stale credential. */
  it('discards the value and restores the session when switched off', async () => {
    const toggle = await signedIn();
    await userEvent.click(toggle);
    await userEvent.type(screen.getByTestId('override-token'), 'atlas_tok_123');
    await waitFor(() => expect(globalThis.__atlasClientOptions?.token).toBe('atlas_tok_123'));

    await userEvent.click(toggle);

    expect(screen.queryByTestId('override-token')).toBeNull();
    await waitFor(() =>
      expect(globalThis.__atlasClientOptions?.token).toBe('header.payload.signature'),
    );
  });

  it('announces plainly when acting as something other than the operator', async () => {
    const toggle = await signedIn();
    await userEvent.click(toggle);
    await userEvent.type(screen.getByTestId('override-token'), 'atlas_tok_123');

    await waitFor(() =>
      expect(screen.getByText(/Acting as a scoped API token/)).toBeInTheDocument(),
    );
  });
});
