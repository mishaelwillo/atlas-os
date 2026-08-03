/**
 * Funnel card (docs/specs/p2/revenue-pilot.md).
 *
 * The API distinguishes "nothing entered this stage" from "nothing converted",
 * and the whole point of this component is not to throw that away at the last
 * step: an unknown rate renders as an em dash, never as 0%.
 */
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import React from 'react';
import { FunnelCard, formatMoney, formatRate, type FunnelData } from './FunnelCard.js';

const MOVED: FunnelData = {
  available: true,
  empty: false,
  stages: [
    { id: 'sourced', label: 'Sourced', count: 40, conversionPercent: null, of: null },
    { id: 'qualified', label: 'Qualified', count: 12, conversionPercent: 40, of: 'assessed' },
    { id: 'replied', label: 'Replied', count: 0, conversionPercent: null, of: 'touch_delivered' },
  ],
  rates: { replyRate: null, qualificationRate: 40 },
  revenue: { recurringMinorByCurrency: { USD: 4900 }, payingCustomers: 1 },
  unavailable: ['provider_cost', 'satisfaction'],
  topBlockers: [{ code: 'outside_cohort_region', count: 5 }],
};

describe('formatRate', () => {
  /** The distinction the API works to preserve. */
  it('renders an unknown rate as an em dash, not as zero', () => {
    expect(formatRate(null)).toBe('—');
    expect(formatRate(undefined)).toBe('—');
    expect(formatRate(0)).toBe('0%');
    expect(formatRate(40)).toBe('40%');
  });
});

describe('formatMoney', () => {
  it('renders minor units with the currency beside them', () => {
    expect(formatMoney(4900, 'USD')).toBe('49.00 USD');
    expect(formatMoney(0, 'JMD')).toBe('0.00 JMD');
  });
});

describe('FunnelCard', () => {
  it('shows each stage with its conversion and what it is measured against', () => {
    render(<FunnelCard data={MOVED} />);
    const card = within(screen.getByTestId('card-funnel'));

    expect(card.getByText('Qualified')).toBeInTheDocument();
    expect(card.getByText('40% of assessed')).toBeInTheDocument();
  });

  /** A stage nothing reached must not read as a stage everyone abandoned. */
  it('renders a stage with no denominator as unknown', () => {
    render(<FunnelCard data={MOVED} />);
    const card = within(screen.getByTestId('card-funnel'));

    expect(card.getByText('— of touch_delivered')).toBeInTheDocument();
    expect(within(screen.getByTestId('funnel-rates')).getByText(/Replied of delivered/)).toHaveTextContent(
      '—',
    );
  });

  it('reports revenue per currency and the paying customer count', () => {
    render(<FunnelCard data={MOVED} />);
    expect(screen.getByTestId('funnel-revenue')).toHaveTextContent('49.00 USD');
    expect(within(screen.getByTestId('card-funnel')).getByText('1 paying')).toBeInTheDocument();
  });

  it('names the metrics nothing records', () => {
    render(<FunnelCard data={MOVED} />);
    expect(screen.getByTestId('funnel-unavailable')).toHaveTextContent('provider_cost');
    expect(screen.getByTestId('funnel-unavailable')).toHaveTextContent('satisfaction');
  });

  it('shows why prospects were disqualified', () => {
    render(<FunnelCard data={MOVED} />);
    expect(screen.getByTestId('funnel-blockers')).toHaveTextContent('outside_cohort_region (5)');
  });

  /** Zero customers is evidence, and the reason is worth stating. */
  it('says an empty funnel is empty by construction, not by outcome', () => {
    render(<FunnelCard data={{ ...MOVED, empty: true }} />);
    expect(screen.getByTestId('funnel-empty')).toHaveTextContent(/no directory adapter/i);
  });

  it('does not claim emptiness when the funnel has moved', () => {
    render(<FunnelCard data={MOVED} />);
    expect(screen.queryByTestId('funnel-empty')).toBeNull();
  });

  /** An unreadable funnel says so rather than rendering zeros. */
  it('reports an unavailable funnel instead of showing an empty one', () => {
    render(<FunnelCard data={{ available: false, note: 'migrations 0004 to 0006' }} />);
    const card = within(screen.getByTestId('card-funnel'));

    expect(card.getByRole('status')).toHaveTextContent('migrations 0004 to 0006');
    expect(screen.queryByTestId('funnel-rates')).toBeNull();
  });
});
