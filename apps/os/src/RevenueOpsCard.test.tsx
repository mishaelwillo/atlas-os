/**
 * Revenue operations card (docs/specs/p2/revenue-pilot.md).
 *
 * Three claims this component must not make:
 *
 * - that a blank price is a free one — zero is a real price, blank is not;
 * - that an approval-gated request activated anything;
 * - that a payment was confirmed, when Atlas never confirms one.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import {
  RevenueOpsCard,
  describeRevenueOutcome,
  formatPrice,
  type RevenueOpsData,
} from './RevenueOpsCard.js';
import type { AtlasGeneratedClient } from '@atlas/client';

const LEAD = 'lead-1';

const DISCLOSURES = [
  'site_ownership',
  'domain_ownership',
  'hosting_scope',
  'security_scope',
  'support_boundary',
  'edit_boundary',
  'data_portability',
  'renewal',
  'taxes',
  'cancellation_refund',
  'suspension',
  'migration',
];

const DATA: RevenueOpsData = {
  available: true,
  dealStates: ['interested', 'discovery', 'offer_review', 'accepted', 'declined'],
  periods: ['monthly', 'yearly'],
  requiredDisclosures: DISCLOSURES,
  items: [
    {
      leadId: LEAD,
      businessName: 'Acme Plumbing',
      offer: {
        offerId: 'o-1',
        version: 2,
        country: 'JM',
        currency: 'JMD',
        priceMinor: 0,
        period: 'monthly',
        termsVersion: 'pilot-1',
      },
      deal: { state: 'offer_review', offerVersion: 2, decidedAt: '2026-08-02T00:00:00.000Z' },
      entitlement: {
        entitlementId: 'e-1',
        state: 'payment_pending',
        offerVersion: 2,
        paymentRecorded: false,
        renewalEnabled: true,
        entitled: false,
        activatedAt: null,
        cancelledAt: null,
        servesUntil: null,
      },
    },
  ],
};

function setup(data: RevenueOpsData = DATA, result: Record<string, unknown> = {}) {
  const calls: Array<{ method: string; input: Record<string, unknown> }> = [];
  const client = {
    offersPublish: async (input: Record<string, unknown>) => {
      calls.push({ method: 'offersPublish', input });
      return (
        result.publish ?? {
          published: true,
          version: 3,
          priceMinor: 0,
          currency: 'JMD',
          period: 'monthly',
        }
      );
    },
    dealsDecide: async (input: Record<string, unknown>) => {
      calls.push({ method: 'dealsDecide', input });
      return result.decide ?? { decided: true, from: 'offer_review', to: 'accepted', offerVersion: 2 };
    },
    hostingActivate: async (input: Record<string, unknown>) => {
      calls.push({ method: 'hostingActivate', input });
      return result.activate ?? { approvalId: 'appr-12345678', status: 'review' };
    },
    hostingCancel: async (input: Record<string, unknown>) => {
      calls.push({ method: 'hostingCancel', input });
      return result.cancel ?? { approvalId: 'appr-87654321', status: 'review' };
    },
  } as unknown as AtlasGeneratedClient;

  const onChanged = vi.fn();
  render(<RevenueOpsCard data={data} client={client} hasSpace onChanged={onChanged} />);
  return { calls, onChanged };
}

describe('formatPrice', () => {
  it('renders zero as a price rather than as nothing', () => {
    expect(formatPrice(0, 'JMD')).toBe('0.00 JMD');
    expect(formatPrice(11900, 'USD')).toBe('119.00 USD');
  });
});

describe('describeRevenueOutcome', () => {
  /** The claim that would matter most if it were wrong. */
  it('never reports an approval-gated request as an activation', () => {
    const text = describeRevenueOutcome({ approvalId: 'appr-12345678', status: 'review' });
    expect(text).toMatch(/Queued for approval/);
    expect(text).toMatch(/nothing has been activated or cancelled/i);
  });

  it('names the disclosures a refused offer was missing', () => {
    expect(
      describeRevenueOutcome({
        published: false,
        code: 'incomplete_disclosures',
        note: 'twelve are required',
        missing: ['taxes', 'renewal'],
      }),
    ).toMatch(/missing: taxes, renewal/);
  });

  it('names a pending schema rather than reporting success', () => {
    expect(
      describeRevenueOutcome({ status: 'schema_pending', note: 'migration 0006 has not run' }),
    ).toMatch(/Nothing was recorded.*0006/);
  });
});

describe('RevenueOpsCard', () => {
  it('states that Atlas never confirms a payment', () => {
    setup();
    expect(screen.getByText(/Atlas never confirms a payment itself/)).toBeInTheDocument();
  });

  it('shows the standing offer, decision and entitlement', () => {
    setup();
    expect(screen.getByTestId(`offer-${LEAD}`)).toHaveTextContent('0.00 JMD');
    expect(screen.getByTestId(`deal-${LEAD}`)).toHaveTextContent('offer_review');
    expect(screen.getByTestId(`entitlement-${LEAD}`)).toHaveTextContent('not serving');
    expect(screen.getByTestId(`entitlement-${LEAD}`)).toHaveTextContent('no payment reference');
  });

  /** Nothing offered is an em dash, never a zero price. */
  it('renders a lead with no offer as an em dash', () => {
    setup({
      ...DATA,
      items: [{ leadId: LEAD, businessName: 'Acme', offer: null, deal: null, entitlement: null }],
    });
    expect(within(screen.getByTestId(`offer-${LEAD}`)).getByText('—')).toBeInTheDocument();
  });

  it('refuses a blank price by name and sends nothing', async () => {
    const { calls } = setup();
    await userEvent.click(screen.getByTestId(`offer-form-${LEAD}`));
    await userEvent.click(screen.getByTestId(`publish-${LEAD}`));

    expect(screen.getByRole('alert')).toHaveTextContent(/Zero is a real price; blank is not/);
    expect(calls).toHaveLength(0);
  });

  it('sends a zero price when zero is what was entered', async () => {
    const { calls } = setup();
    await userEvent.click(screen.getByTestId(`offer-form-${LEAD}`));
    await userEvent.type(screen.getByTestId('offer-country'), 'jm');
    await userEvent.type(screen.getByTestId('offer-currency'), 'jmd');
    await userEvent.type(screen.getByTestId('offer-price'), '0');
    await userEvent.type(screen.getByTestId('offer-terms'), 'pilot-1');
    await userEvent.click(screen.getByTestId(`publish-${LEAD}`));

    await waitFor(() => expect(calls).toHaveLength(1));
    const input = calls[0].input as Record<string, unknown>;
    expect(input.priceMinor).toBe(0);
    // Uppercased on the way out, because the API's check is on the ISO form.
    expect(input.country).toBe('JM');
    expect(input.currency).toBe('JMD');
  });

  it('names the disclosures still missing before anything is sent', async () => {
    setup();
    await userEvent.click(screen.getByTestId(`offer-form-${LEAD}`));
    expect(screen.getByTestId('missing-disclosures')).toHaveTextContent('taxes');
    await userEvent.type(screen.getByTestId('disclosure-taxes'), 'taxes are extra');
    expect(screen.getByTestId('missing-disclosures')).not.toHaveTextContent(/\btaxes\b/);
  });

  it('records a deal decision with its notes', async () => {
    const { calls } = setup();
    await userEvent.selectOptions(screen.getByTestId(`deal-state-${LEAD}`), 'accepted');
    await userEvent.type(screen.getByTestId(`deal-notes-${LEAD}`), 'owner said yes on the call');
    await userEvent.click(screen.getByTestId(`decide-${LEAD}`));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].input).toEqual({
      leadId: LEAD,
      state: 'accepted',
      notes: 'owner said yes on the call',
    });
  });

  /** The button asks for an approval; it does not activate. */
  it('reports an activation request as queued for approval', async () => {
    const { calls } = setup();
    await userEvent.click(screen.getByTestId(`activate-${LEAD}`));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(screen.getByTestId('revenue-outcome')).toHaveTextContent(/Queued for approval/);
    expect(screen.getByTestId('revenue-outcome')).toHaveTextContent(/nothing has been activated/i);
  });

  it('reports a cancellation request the same way', async () => {
    setup();
    await userEvent.click(screen.getByTestId(`cancel-${LEAD}`));
    await waitFor(() =>
      expect(screen.getByTestId('revenue-outcome')).toHaveTextContent(/Queued for approval/),
    );
  });

  it('refuses to act without a Space and says why', async () => {
    const calls: unknown[] = [];
    const client = {
      hostingActivate: async () => {
        calls.push(1);
        return {};
      },
    } as unknown as AtlasGeneratedClient;
    render(<RevenueOpsCard data={DATA} client={client} hasSpace={false} onChanged={vi.fn()} />);
    await userEvent.click(screen.getByTestId(`activate-${LEAD}`));

    expect(screen.getByRole('alert')).toHaveTextContent(/Select a Space/);
    expect(calls).toHaveLength(0);
  });

  it('reports an unavailable pipeline instead of an empty one', () => {
    render(
      <RevenueOpsCard
        data={{ available: false, note: 'migrations 0004 to 0006' }}
        client={{} as AtlasGeneratedClient}
        hasSpace
        onChanged={vi.fn()}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('migrations 0004 to 0006');
  });
});
