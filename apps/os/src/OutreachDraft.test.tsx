/**
 * Outreach drafting (docs/specs/p2/revenue-pilot.md).
 *
 * The capability is approval-gated, so drafting must queue a review and never
 * imply a send. These tests pin that the UI says so and that nothing is
 * submitted without the inputs the API requires.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MissionControlLive } from './MissionControl.js';

declare global {
  // eslint-disable-next-line no-var
  var __atlasOutreachCalls: Array<Record<string, unknown>>;
}

vi.mock('@atlas/client', () => ({
  createGeneratedClient: () => ({
    statusMissionControl: async () => ({
      ok: true,
      generatedAt: new Date().toISOString(),
      cards: [
        {
          id: 'leads',
          kind: 'leads',
          title: 'Leads',
          data: { items: (globalThis as Record<string, unknown>).__atlasLeads ?? [] },
        },
      ],
    }),
    outreachSend: async (input: Record<string, unknown>) => {
      globalThis.__atlasOutreachCalls.push(input);
      return { approvalId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', status: 'review' };
    },
  }),
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
      // One space, so it auto-selects and governed actions are permitted.
      from: () => ({
        select: () => ({
          order: async () => ({
            data: [{ space_id: 'space-1', slug: 'atlas', name: 'Atlas OS' }],
            error: null,
          }),
        }),
      }),
    }),
  };
});

function setup(leads: unknown[] = []) {
  globalThis.__atlasOutreachCalls = [];
  (globalThis as Record<string, unknown>).__atlasLeads = leads;
  render(<MissionControlLive />);
  return screen.findByTestId('card-outreach');
}

describe('outreach drafting', () => {
  /** The gate must be legible: this queues a review, it does not send. */
  it('describes itself as queuing an approval, not sending', async () => {
    const card = await setup();
    expect(within(card).getByText(/Nothing is sent until you approve it/i)).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Queue for approval' })).toBeInTheDocument();
  });

  it('submits the lead, channel and body, and reports the approval', async () => {
    await setup();
    await userEvent.type(screen.getByTestId('lead-id'), 'lead-abc');
    await userEvent.selectOptions(screen.getByTestId('channel-select'), 'sms');
    await userEvent.type(screen.getByTestId('outreach-body'), 'Hello there');
    await userEvent.click(screen.getByTestId('queue-approval'));

    await waitFor(() => expect(globalThis.__atlasOutreachCalls).toHaveLength(1));
    expect(globalThis.__atlasOutreachCalls[0]).toEqual({
      leadId: 'lead-abc',
      channel: 'sms',
      body: 'Hello there',
    });
    await waitFor(() =>
      expect(screen.getByTestId('queued-notice')).toHaveTextContent(/nothing sent/i),
    );
  });

  /** The API requires both; failing locally beats a 400 round trip. */
  it('refuses to submit without a lead reference or a body', async () => {
    const card = await setup();
    await userEvent.click(screen.getByTestId('queue-approval'));

    expect(globalThis.__atlasOutreachCalls).toHaveLength(0);
    expect(within(card).getByRole('alert')).toHaveTextContent(/both required/i);
  });

  it('trims whitespace rather than submitting padded values', async () => {
    await setup();
    await userEvent.type(screen.getByTestId('lead-id'), '  lead-abc  ');
    await userEvent.type(screen.getByTestId('outreach-body'), '  Hello  ');
    await userEvent.click(screen.getByTestId('queue-approval'));

    await waitFor(() => expect(globalThis.__atlasOutreachCalls).toHaveLength(1));
    expect(globalThis.__atlasOutreachCalls[0].leadId).toBe('lead-abc');
    expect(globalThis.__atlasOutreachCalls[0].body).toBe('Hello');
  });

  it('offers a picker once leads exist', async () => {
    await setup([
      { leadId: 'lead-1', businessName: 'Acme Plumbing', status: 'new', phone: null, score: 8 },
    ]);
    const select = await screen.findByTestId('lead-select');
    expect(within(select).getByRole('option', { name: /Acme Plumbing/ })).toBeInTheDocument();
    expect(screen.queryByTestId('lead-id')).toBeNull();
  });

  /** Sourcing is unbuilt; say so rather than showing an empty control. */
  it('explains the empty lead list instead of leaving it bare', async () => {
    const card = await setup();
    expect(within(card).getByText(/directory adapter/i)).toBeInTheDocument();
  });

  it('clears the message after queueing so it cannot be sent twice', async () => {
    await setup();
    await userEvent.type(screen.getByTestId('lead-id'), 'lead-abc');
    await userEvent.type(screen.getByTestId('outreach-body'), 'Hello');
    await userEvent.click(screen.getByTestId('queue-approval'));

    await waitFor(() => expect(globalThis.__atlasOutreachCalls).toHaveLength(1));
    expect((screen.getByTestId('outreach-body') as HTMLTextAreaElement).value).toBe('');
  });
});
