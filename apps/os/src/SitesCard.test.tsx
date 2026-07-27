/**
 * Preview viewer safety and behaviour.
 *
 * The generated build is produced from third-party listing facts, and this
 * page holds an operator session with full scopes. The build must therefore
 * never execute in this origin, no matter what the renderer already escaped.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MissionControlLive } from './MissionControl.js';

declare global {
  // Swapped per case; the mock factory below is hoisted, so it must read this
  // through the global rather than closing over a module variable.
  // eslint-disable-next-line no-var
  var __atlasTestClient: Record<string, unknown>;
}

/**
 * Drive the card through the real component tree by stubbing only the
 * generated client, so the sandbox attributes under test are the ones the app
 * actually renders.
 */
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
      from: () => ({
        select: () => ({ order: async () => ({ data: [], error: null }) }),
      }),
    }),
  };
});

const SITE = '99999999-8888-7777-6666-555555555555';
const PREVIEW_HTML =
  '<!doctype html><html><body><span class="fact">Acme Plumbing</span></body></html>';

function statusPayload() {
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    cards: [
      {
        id: 'sites',
        kind: 'sites',
        title: 'Sites',
        data: {
          items: [
            {
              siteId: SITE,
              businessName: 'Acme Plumbing',
              status: 'draft',
              template: 'trades-1',
              updatedAt: new Date().toISOString(),
            },
          ],
        },
      },
    ],
  };
}

function installClient(preview: unknown) {
  globalThis.__atlasTestClient = {
    statusMissionControl: async () => statusPayload(),
    factoryPreview: async () => preview,
    approvalsDecide: async () => ({ ok: true }),
  };
}

describe('preview viewer', () => {
  it('renders the build inside a fully sandboxed frame', async () => {
    installClient({ html: PREVIEW_HTML, hash: 'a'.repeat(64), expired: false });
    render(<MissionControlLive />);

    const button = await screen.findByRole('button', { name: 'Preview' });
    await userEvent.click(button);

    const frame = await screen.findByTestId('preview-frame');
    // Empty sandbox: no scripts, opaque origin. allow-same-origin here would
    // let generated markup reach this authenticated page.
    expect(frame.getAttribute('sandbox')).toBe('');
    expect(frame.getAttribute('sandbox')).not.toContain('allow-same-origin');
    expect(frame.getAttribute('sandbox')).not.toContain('allow-scripts');
    expect(frame.getAttribute('srcdoc')).toContain('Acme Plumbing');
  });

  /** The build must never be injected into this document directly. */
  it('does not place the build in the page itself', async () => {
    installClient({ html: PREVIEW_HTML, hash: 'a'.repeat(64), expired: false });
    const { container } = render(<MissionControlLive />);

    await userEvent.click(await screen.findByRole('button', { name: 'Preview' }));
    await screen.findByTestId('preview-frame');

    expect(container.querySelector('.fact')).toBeNull();
  });

  it('reports an expired preview instead of rendering a frame', async () => {
    installClient({ expired: true, expiresAt: '2026-07-01T00:00:00.000Z' });
    render(<MissionControlLive />);

    await userEvent.click(await screen.findByRole('button', { name: 'Preview' }));

    await waitFor(() => expect(within(screen.getByTestId('card-sites')).getByRole('alert')).toHaveTextContent(/expired/i));
    expect(screen.queryByTestId('preview-frame')).toBeNull();
  });

  it('reports template issues instead of rendering a frame', async () => {
    installClient({
      expired: false,
      issues: [{ code: 'section_facts_missing', detail: "section 'contact' requires phone" }],
    });
    render(<MissionControlLive />);

    await userEvent.click(await screen.findByRole('button', { name: 'Preview' }));

    await waitFor(() => expect(within(screen.getByTestId('card-sites')).getByRole('alert')).toHaveTextContent(/requires phone/));
    expect(screen.queryByTestId('preview-frame')).toBeNull();
  });

  it('surfaces a failed preview request', async () => {
    globalThis.__atlasTestClient = {
      statusMissionControl: async () => statusPayload(),
      factoryPreview: async () => {
        throw new Error('Atlas API error 404');
      },
    };
    render(<MissionControlLive />);

    await userEvent.click(await screen.findByRole('button', { name: 'Preview' }));

    await waitFor(() => expect(within(screen.getByTestId('card-sites')).getByRole('alert')).toHaveTextContent(/404/));
  });
});
