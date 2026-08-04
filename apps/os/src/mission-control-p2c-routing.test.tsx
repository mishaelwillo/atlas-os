/**
 * Mission Control routes the P2C card kinds to components.
 *
 * The switch has a default that dumps a card's JSON, which is the right
 * fallback for a kind this build does not know — and exactly what a card would
 * silently degrade to if someone added a kind on the server and forgot the
 * case here. Nothing else checks that, so this does: the three P2C kinds must
 * render their components, and the fallback must still exist for a kind that
 * really is unknown.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { MissionControlLive } from './MissionControl.js';

declare global {
  var __atlasTestClient: Record<string, unknown>;
}

vi.mock('@atlas/client', () => ({
  createGeneratedClient: () => globalThis.__atlasTestClient,
}));

vi.mock('./session.js', async () => {
  const actual = await vi.importActual<typeof import('./session.js')>('./session.js');
  return {
    ...actual,
    getSupabase: () => ({
      auth: {
        getSession: async () => ({
          data: { session: { access_token: 'jwt', user: { email: 'mobiledynamic876@gmail.com' } } },
        }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
        signOut: async () => undefined,
      },
      from: () => ({ select: () => ({ order: async () => ({ data: [], error: null }) }) }),
    }),
  };
});

/** Mirrors the card kinds handlers/status.ts emits for the revenue pilot. */
const P2C_CARDS = [
  {
    id: 'prospects',
    kind: 'prospects',
    title: 'Prospects and demo queue',
    data: { available: true, queue: null, items: [] },
    testId: 'card-prospects',
  },
  {
    id: 'sequences',
    kind: 'sequences',
    title: 'Outreach sequences',
    data: { available: true, channels: [], items: [] },
    testId: 'card-sequences',
  },
  {
    id: 'revenue_ops',
    kind: 'revenue_ops',
    title: 'Offers, deals and hosting',
    data: { available: true, items: [] },
    testId: 'card-revenue-ops',
  },
];

function installClient(): void {
  globalThis.__atlasTestClient = {
    statusMissionControl: async () => ({
      ok: true,
      generatedAt: new Date().toISOString(),
      cards: [
        ...P2C_CARDS.map(({ id, kind, title, data }) => ({ id, kind, title, data })),
        // A kind this build genuinely does not know.
        { id: 'unknown', kind: 'not_a_real_kind', title: 'Unknown', data: { a: 1 } },
      ],
    }),
  };
}

describe('P2C card routing', () => {
  it.each(P2C_CARDS)('renders the $kind card as a component', async ({ testId }) => {
    installClient();
    const { container } = render(<MissionControlLive />);

    const card = await screen.findByTestId(testId);
    expect(card).toBeInTheDocument();
    // A component, not the JSON fallback.
    expect(card.querySelector('pre')).toBeNull();
    expect(container).toBeTruthy();
  });

  it('still falls back to a JSON dump for a kind it does not know', async () => {
    installClient();
    const { container } = render(<MissionControlLive />);

    await screen.findByTestId('card-prospects');
    expect(container.querySelector('pre')?.textContent).toContain('"a": 1');
  });
});
