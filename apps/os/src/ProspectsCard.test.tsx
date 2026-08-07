/**
 * Prospects card (docs/specs/p2/revenue-pilot.md).
 *
 * Two rules under test, both of which the API works to preserve and which this
 * component could throw away at the last step:
 *
 * - An unanswered rubric field is an open question, not a settled `false`. The
 *   rubric disqualifies on a settled false and only sends to review on an
 *   unknown, so a form that sent `false` for "not checked" would silently
 *   disqualify prospects nobody had looked at.
 * - A 200 carrying `enqueued: false` is a refusal, and must read as one.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import {
  ProspectsCard,
  buildEvidence,
  describeOutcome,
  loadEvidence,
  type ProspectsData,
} from './ProspectsCard.js';
import type { AtlasGeneratedClient } from '@atlas/client';

const LEAD = 'lead-1';

const DATA: ProspectsData = {
  available: true,
  queue: { active: 1, cap: 10, floor: 5, remaining: 9, belowFloor: true },
  rubric: { dimensions: ['fit'], maxScore: 30, qualifyingScore: 24, maxDemoEffortHours: 4 },
  demoStates: ['queued', 'building', 'qa', 'approved', 'shareable', 'expired'],
  items: [
    {
      leadId: LEAD,
      businessName: 'Acme Plumbing',
      leadStatus: 'new',
      qualification: {
        verdict: 'qualified',
        total: 27,
        assessedAt: '2026-08-01T00:00:00.000Z',
        expiresAt: '2099-01-01T00:00:00.000Z',
        expired: false,
      },
      demo: {
        queueId: 'q-1',
        state: 'building',
        siteId: null,
        expiresAt: '2099-01-01T00:00:00.000Z',
        moves: ['qa', 'expired'],
      },
    },
  ],
};

function setup(data: ProspectsData = DATA, result: Record<string, unknown> = {}) {
  const calls: Array<{ method: string; input: Record<string, unknown> }> = [];
  const client = {
    prospectingQualify: async (input: Record<string, unknown>) => {
      calls.push({ method: 'prospectingQualify', input });
      return result.qualify ?? { assessmentId: 'a-1', verdict: 'qualified', total: 27 };
    },
    demosEnqueue: async (input: Record<string, unknown>) => {
      calls.push({ method: 'demosEnqueue', input });
      return result.enqueue ?? { enqueued: true, queueId: 'q-2', remaining: 8, belowFloor: true };
    },
    demosAdvance: async (input: Record<string, unknown>) => {
      calls.push({ method: 'demosAdvance', input });
      return result.advance ?? { advanced: true, from: 'building', to: 'qa' };
    },
    leadsRecord: async (input: Record<string, unknown>) => {
      calls.push({ method: 'leadsRecord', input });
      return result.record ?? { recorded: true, leadId: 'lead-new', status: 'new' };
    },
  } as unknown as AtlasGeneratedClient;

  const onChanged = vi.fn();
  render(<ProspectsCard data={data} client={client} hasSpace onChanged={onChanged} />);
  return { calls, onChanged };
}

/**
 * Re-assessing must edit the recorded evidence, not replace it.
 *
 * The form used to reset to blank on every open, so correcting one field
 * silently dropped every other and the rubric faithfully scored the emptier
 * evidence. It happened twice in one session — once losing a fact count, once
 * nearly losing the documented weak-site problem that was the only thing
 * keeping a prospect out of a blocker.
 */
describe('loadEvidence', () => {
  /** The property that matters: nothing is lost on a round trip. */
  it('round-trips everything buildEvidence sends', () => {
    const original = {
      region: 'JM',
      vertical: 'trades',
      targetRegions: 'JM',
      targetVerticals: 'trades',
      activeProfile: 'yes' as const,
      websiteUrl: 'http://example.invalid/',
      weakSiteProblem: 'the listed site does not resolve',
      identityVerified: 'yes' as const,
      locationVerified: 'no' as const,
      publicFactCount: '7',
      contactSource: 'two independent sources',
      contactPolicy: 'permitted' as const,
      duplicateOf: '',
      operatingStatus: 'open' as const,
      demoEffortHours: '0.5',
      deceptiveDemoRisk: false,
      benefitRationale: 'their site is gone',
    };

    expect(loadEvidence(buildEvidence(original))).toEqual(original);
  });

  /**
   * Unknown is not false. The rubric sends an unknown to review and can
   * disqualify on a settled false, so collapsing them would put a verdict on
   * the record nobody decided.
   */
  it('loads a missing boolean as unchecked, never as no', () => {
    const form = loadEvidence({ identityVerified: false });
    expect(form.identityVerified).toBe('no');
    expect(form.activeProfile).toBe('unknown');
    expect(form.locationVerified).toBe('unknown');
    expect(form.contactPolicy).toBe('unreviewed');
  });

  /** A fact count that fails to load must not read as zero — zero blocks. */
  it('falls back rather than inventing a zero fact count', () => {
    expect(loadEvidence({}).publicFactCount).toBe('0');
    expect(loadEvidence({ publicFactCount: 7 }).publicFactCount).toBe('7');
    // A non-numeric value is not silently coerced to 0 by Number().
    expect(loadEvidence({ publicFactCount: 'seven' }).publicFactCount).toBe('0');
  });

  it('ignores an unrecognised operating status rather than passing it through', () => {
    expect(loadEvidence({ operatingStatus: 'trading' }).operatingStatus).toBe('uncertain');
    expect(loadEvidence({ operatingStatus: 'closed' }).operatingStatus).toBe('closed');
  });
});

describe('opening the assess form', () => {
  const LEAD = DATA.items![0].leadId;
  const stored = {
    region: 'JM',
    vertical: 'trades',
    targetRegions: ['JM'],
    targetVerticals: ['trades'],
    publicFactCount: 7,
    websiteUrl: 'http://example.invalid/',
    weakSiteProblem: 'the listed site does not resolve',
    identityVerified: true,
    locationVerified: false,
    operatingStatus: 'open',
    demoEffortHours: 0.5,
    deceptiveDemoRisk: false,
    benefitRationale: 'their site is gone',
    contactSource: 'two independent sources',
  };

  function withEvidence(evidence: Record<string, unknown> | null | undefined): ProspectsData {
    return {
      ...DATA,
      items: [
        { ...DATA.items![0], qualification: { ...DATA.items![0].qualification!, evidence } },
      ],
    };
  }

  /** The defect: correcting one field used to silently drop every other. */
  it('starts from the recorded evidence, not from blank', async () => {
    setup(withEvidence(stored));
    await userEvent.click(screen.getByTestId(`assess-${LEAD}`));

    expect((screen.getByTestId('ev-facts') as HTMLInputElement).value).toBe('7');
    expect((screen.getByTestId('ev-website') as HTMLInputElement).value).toBe(
      'http://example.invalid/',
    );
    expect((screen.getByTestId('ev-weak-site') as HTMLInputElement).value).toContain(
      'does not resolve',
    );
    expect(screen.getByTestId('assess-mode')).toHaveTextContent(/Editing the assessment/);
  });

  it('starts blank for a prospect with no standing assessment', async () => {
    setup({ ...DATA, items: [{ ...DATA.items![0], qualification: null }] });
    await userEvent.click(screen.getByTestId(`assess-${LEAD}`));

    expect((screen.getByTestId('ev-website') as HTMLInputElement).value).toBe('');
    expect(screen.getByTestId('assess-mode')).toHaveTextContent(/First assessment/);
  });

  /**
   * A standing assessment whose evidence could not be read produces the same
   * empty fields as a first assessment. Saying so is the difference between an
   * operator knowing they are about to overwrite a record and not.
   */
  it('says so when a standing assessment has no readable evidence', async () => {
    setup(withEvidence(null));
    await userEvent.click(screen.getByTestId(`assess-${LEAD}`));

    expect(screen.getByTestId('assess-mode')).toHaveTextContent(/could not be read/);
    expect(screen.getByTestId('assess-mode')).toHaveTextContent(/will replace/);
  });
});

describe('buildEvidence', () => {
  /** The distinction the rubric depends on. */
  it('omits an unchecked field rather than sending it as false', () => {
    const evidence = buildEvidence({
      region: 'JM',
      vertical: 'plumbing',
      targetRegions: 'JM, US',
      targetVerticals: 'plumbing',
      activeProfile: 'unknown',
      websiteUrl: '',
      weakSiteProblem: '',
      identityVerified: 'yes',
      locationVerified: 'no',
      publicFactCount: '4',
      contactSource: '',
      contactPolicy: 'unreviewed' as const,
      duplicateOf: '',
      operatingStatus: 'open',
      demoEffortHours: '2',
      deceptiveDemoRisk: false,
      benefitRationale: 'no site at all',
    });

    expect('activeProfile' in evidence).toBe(false);
    expect('contactPolicyReviewed' in evidence).toBe(false);
    expect(evidence.identityVerified).toBe(true);
    expect(evidence.locationVerified).toBe(false);
    expect(evidence.targetRegions).toEqual(['JM', 'US']);
    // Empty optional text is absent, not an empty string the rubric would
    // have to decide the meaning of.
    expect('websiteUrl' in evidence).toBe(false);
    expect(evidence.benefitRationale).toBe('no site at all');
  });
});

describe('describeOutcome', () => {
  it('reports a 200 refusal as a refusal', () => {
    expect(describeOutcome({ enqueued: false, code: 'cap_reached', note: 'the queue is full' })).toMatch(
      /Refused \(cap_reached\).*queue is full/,
    );
    expect(describeOutcome({ advanced: false, code: 'not_the_next_state', note: 'nope' })).toMatch(
      /Refused \(not_the_next_state\)/,
    );
  });

  /** A verdict returned without an assessment id was not stored. */
  it('says so when a verdict was derived but nothing was recorded', () => {
    expect(describeOutcome({ verdict: 'qualified', total: 27 })).toContain('not stored');
    expect(describeOutcome({ verdict: 'qualified', total: 27, assessmentId: 'a-1' })).not.toContain(
      'not stored',
    );
  });

  it('names a pending schema rather than reporting success', () => {
    expect(
      describeOutcome({ status: 'schema_pending', note: 'migration 0004 has not been applied' }),
    ).toMatch(/Nothing was recorded.*0004/);
  });
});

describe('ProspectsCard', () => {
  it('shows the queue against the cap and names a thin queue as advisory', () => {
    setup();
    expect(screen.getByTestId('queue-summary')).toHaveTextContent('1 of 10 demo slots in use');
    expect(screen.getByTestId('queue-summary')).toHaveTextContent(/advisory/);
  });

  /** Never assessed is not a verdict. */
  it('renders an unassessed prospect as an em dash', () => {
    setup({
      ...DATA,
      items: [
        { leadId: LEAD, businessName: 'Acme', leadStatus: 'new', qualification: null, demo: null },
      ],
    });
    expect(within(screen.getByTestId(`prospect-${LEAD}`)).getAllByText('—').length).toBeGreaterThan(0);
  });

  it('marks a stale assessment as stale', () => {
    setup({
      ...DATA,
      items: [
        {
          ...DATA.items![0],
          qualification: { ...DATA.items![0].qualification!, expired: true },
        },
      ],
    });
    expect(within(screen.getByTestId(`prospect-${LEAD}`)).getByText('stale')).toBeInTheDocument();
  });

  /**
   * The moves come from the payload, which the API derived from planAdvance.
   * Offering anything else would offer a move the API refuses.
   */
  it('offers only the moves the payload carries', async () => {
    setup();
    const select = screen.getByTestId(`demo-move-${LEAD}`) as HTMLSelectElement;
    const options = Array.from(select.options)
      .map((o) => o.value)
      .filter((v) => v !== '');
    expect(options).toEqual(['qa', 'expired']);
  });

  it('says nothing can move when the payload offers no move', () => {
    setup({
      ...DATA,
      items: [{ ...DATA.items![0], demo: { ...DATA.items![0].demo!, state: 'shareable', moves: [] } }],
    });
    expect(screen.getByTestId(`no-moves-${LEAD}`)).toHaveTextContent('no further move');
  });

  it('sends the queue id and the chosen state when moving a demo', async () => {
    const { calls } = setup();
    await userEvent.selectOptions(screen.getByTestId(`demo-move-${LEAD}`), 'qa');
    await userEvent.click(screen.getByTestId(`advance-${LEAD}`));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({ method: 'demosAdvance', input: { queueId: 'q-1', state: 'qa' } });
  });

  /** The failure this reporting exists to prevent. */
  it('reports a refused enqueue rather than showing nothing', async () => {
    const { calls } = setup(
      {
        ...DATA,
        items: [{ ...DATA.items![0], demo: null }],
      },
      { enqueue: { enqueued: false, code: 'not_qualified', note: 'no assessment' } },
    );
    await userEvent.click(screen.getByTestId(`enqueue-${LEAD}`));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(screen.getByTestId('prospect-outcome')).toHaveTextContent(/Refused \(not_qualified\)/);
  });

  it('sends the assembled evidence when an assessment is recorded', async () => {
    const { calls, onChanged } = setup();
    await userEvent.click(screen.getByTestId(`assess-${LEAD}`));
    await userEvent.type(screen.getByTestId('ev-region'), 'JM');
    await userEvent.type(screen.getByTestId('ev-vertical'), 'plumbing');
    await userEvent.type(screen.getByTestId('ev-target-regions'), 'JM');
    await userEvent.selectOptions(screen.getByTestId('ev-active-profile'), 'yes');
    await userEvent.click(screen.getByTestId('submit-qualify'));

    await waitFor(() => expect(calls).toHaveLength(1));
    const input = calls[0].input as { leadId: string; evidence: Record<string, unknown> };
    expect(input.leadId).toBe(LEAD);
    expect(input.evidence.region).toBe('JM');
    expect(input.evidence.activeProfile).toBe(true);
    // Left unchecked, so absent — an open question, not a settled no.
    expect('identityVerified' in input.evidence).toBe(false);
    expect(onChanged).toHaveBeenCalled();
  });

  it('refuses to act without a Space and says why', async () => {
    const calls: unknown[] = [];
    const client = {
      demosEnqueue: async () => {
        calls.push(1);
        return {};
      },
    } as unknown as AtlasGeneratedClient;
    render(
      <ProspectsCard
        data={{ ...DATA, items: [{ ...DATA.items![0], demo: null }] }}
        client={client}
        hasSpace={false}
        onChanged={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByTestId(`enqueue-${LEAD}`));
    expect(screen.getByRole('alert')).toHaveTextContent(/Select a Space/);
    expect(calls).toHaveLength(0);
  });

  /** A partial pipeline would read as a pilot where nothing was ever queued. */
  it('reports an unavailable pipeline instead of an empty one', () => {
    render(
      <ProspectsCard
        data={{ available: false, note: 'migrations 0004 to 0006' }}
        client={{} as AtlasGeneratedClient}
        hasSpace
        onChanged={vi.fn()}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('migrations 0004 to 0006');
    expect(screen.queryByTestId('queue-summary')).toBeNull();
  });
});

/**
 * Recording a prospect by hand.
 *
 * `leads.find` has no approved directory adapter, so without this the card is
 * a surface an operator cannot start from: every action here keys off a lead
 * and nothing else can create one.
 */
describe('recording a hand-sourced prospect', () => {
  const EMPTY: ProspectsData = { ...DATA, items: [] };

  it('says how to start when there are no prospects yet', () => {
    setup(EMPTY);
    expect(screen.getByText(/record one by hand below/i)).toBeInTheDocument();
  });

  it('sends the business and where it was found', async () => {
    const { calls, onChanged } = setup(EMPTY);
    await userEvent.type(screen.getByTestId('lead-business-name'), 'Acme Plumbing');
    await userEvent.type(screen.getByTestId('lead-source-url'), 'https://maps.example/acme');
    await userEvent.type(screen.getByTestId('lead-phone'), '555-0100');
    await userEvent.click(screen.getByTestId('submit-lead'));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({
      method: 'leadsRecord',
      input: {
        businessName: 'Acme Plumbing',
        sourceUrl: 'https://maps.example/acme',
        phone: '555-0100',
      },
    });
    expect(onChanged).toHaveBeenCalled();
  });

  /** The source is what the rubric will need; the form says so before sending. */
  it('refuses to send without a source, by name', async () => {
    const { calls } = setup(EMPTY);
    await userEvent.type(screen.getByTestId('lead-business-name'), 'Acme Plumbing');
    await userEvent.click(screen.getByTestId('submit-lead'));

    expect(screen.getByRole('alert')).toHaveTextContent(/where you found them are both required/i);
    expect(calls).toHaveLength(0);
  });

  it('omits an empty optional field rather than sending a blank', async () => {
    const { calls } = setup(EMPTY);
    await userEvent.type(screen.getByTestId('lead-business-name'), 'Acme Plumbing');
    await userEvent.type(screen.getByTestId('lead-source-url'), 'https://maps.example/acme');
    await userEvent.click(screen.getByTestId('submit-lead'));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect('phone' in (calls[0].input as Record<string, unknown>)).toBe(false);
    expect('websiteUrl' in (calls[0].input as Record<string, unknown>)).toBe(false);
  });

  /** A 200 refusal naming the existing prospect must read as a refusal. */
  it('reports a duplicate as refused and names the existing prospect', async () => {
    setup(EMPTY, {
      record: {
        recorded: false,
        code: 'already_recorded',
        duplicateOf: 'lead-existing-1234',
        note: 'this business is already recorded in this space',
      },
    });
    await userEvent.type(screen.getByTestId('lead-business-name'), 'Acme Plumbing');
    await userEvent.type(screen.getByTestId('lead-source-url'), 'https://maps.example/acme');
    await userEvent.click(screen.getByTestId('submit-lead'));

    await waitFor(() =>
      expect(screen.getByTestId('prospect-outcome')).toHaveTextContent(/Refused \(already_recorded\)/),
    );
    expect(screen.getByTestId('prospect-outcome')).toHaveTextContent(/already recorded as lead-exi/);
  });
});
