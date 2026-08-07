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
import {
  FunnelCard,
  describeRecordOutcome,
  formatMoney,
  formatRate,
  type FunnelData,
} from './FunnelCard.js';

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

  /**
   * The unavailable branch returns before the form renders, so its hook count
   * must still match. Rendering both shapes in one test is what catches a hook
   * declared after the early return.
   */
  it('survives switching between available and unavailable', () => {
    const { rerender } = render(<FunnelCard data={MOVED} client={{} as never} hasSpace />);
    rerender(<FunnelCard data={{ available: false, note: 'gone' }} client={{} as never} hasSpace />);
    rerender(<FunnelCard data={MOVED} client={{} as never} hasSpace />);
    expect(screen.getByTestId('card-funnel')).toBeTruthy();
  });
});

/**
 * The cost, support and outcome half of the exit criterion.
 *
 * The capabilities existed with no operator surface — the same gap the twelve
 * P2C capabilities shipped with, where everything was drivable only by API and
 * so nothing got recorded.
 */
describe('the cost record', () => {
  const COMPLETE: FunnelData = {
    ...MOVED,
    costRecord: {
      minorByCurrency: { USD: 2_500 },
      minutesByCategory: { labour: 120 },
      satisfaction: 4.5,
      satisfactionCount: 2,
      complete: true,
      missingCategories: [],
      satisfactionMissing: false,
    },
    grossMarginMinorByCurrency: { USD: 7_500 },
    grossMarginUnavailableReason: null,
  };

  it('shows recorded money and time without adding them together', () => {
    render(<FunnelCard data={COMPLETE} />);
    expect(screen.getByTestId('funnel-cost-USD')).toHaveTextContent('25.00 USD');
    expect(screen.getByTestId('funnel-minutes-labour')).toHaveTextContent('120 min');
    expect(screen.getByTestId('funnel-minutes-labour')).toHaveTextContent('not priced');
  });

  it('shows margin once the record is complete', () => {
    render(<FunnelCard data={COMPLETE} />);
    expect(screen.getByTestId('funnel-margin')).toHaveTextContent('75.00 USD');
  });

  /** A margin from part of the costs is always too high, so it is withheld. */
  it('withholds margin and says why while the record is incomplete', () => {
    render(
      <FunnelCard
        data={{
          ...COMPLETE,
          costRecord: { ...COMPLETE.costRecord, complete: false, missingCategories: ['support'] },
          grossMarginMinorByCurrency: null,
          grossMarginUnavailableReason: 'the cost record is incomplete',
        }}
      />,
    );
    const margin = screen.getByTestId('funnel-margin');
    expect(margin).toHaveTextContent('—');
    expect(margin).toHaveTextContent('incomplete');
    expect(margin).not.toHaveTextContent('75.00');
  });

  /** Nobody asked is not the same as indifferent. */
  it('renders an unrecorded satisfaction as a gap, not a number', () => {
    render(
      <FunnelCard
        data={{
          ...COMPLETE,
          costRecord: { ...COMPLETE.costRecord, satisfaction: null, satisfactionCount: 0 },
        }}
      />,
    );
    expect(screen.getByTestId('funnel-satisfaction')).toHaveTextContent('nobody has been asked');
  });

  it('offers no recording form without a client', () => {
    render(<FunnelCard data={COMPLETE} />);
    expect(screen.queryByTestId('record-cost')).toBeNull();
  });

  it('builds its category list from the API, not a hand-written one', () => {
    render(
      <FunnelCard
        data={{ ...COMPLETE, costCategories: ['provider', 'labour'] }}
        client={{} as never}
        hasSpace
      />,
    );
    const options = Array.from((screen.getByTestId('cost-category') as HTMLSelectElement).options)
      .map((o) => o.value)
      .filter(Boolean);
    expect(options).toEqual(['provider', 'labour']);
  });
});

describe('describeRecordOutcome', () => {
  /** A 200 carrying recorded:false is a refusal and must read as one. */
  it('reports a refusal with its code rather than as success', () => {
    expect(
      describeRecordOutcome({ recorded: false, code: 'money_and_time', note: 'not both' }),
    ).toMatch(/Refused \(money_and_time\)/);
  });

  it('names a pending schema rather than failing quietly', () => {
    expect(describeRecordOutcome({ status: 'schema_pending', note: '0012 not applied' })).toMatch(
      /Nothing was recorded/,
    );
  });

  it('confirms a recorded cost and a recorded outcome', () => {
    expect(describeRecordOutcome({ recorded: true, entryId: 'e1', category: 'provider' })).toMatch(
      /Recorded a provider cost/,
    );
    expect(describeRecordOutcome({ recorded: true, outcomeId: 'o1', satisfaction: 4 })).toMatch(
      /satisfaction 4/,
    );
  });
});
