/**
 * Sequence card (docs/specs/p2/revenue-pilot.md).
 *
 * The rule this component must not soften: a sequence cannot send, and cannot
 * record a send. The moves it offers are the ones the API derived from its own
 * rule function, so `sent` never appears — and a `scheduled` touch, whose only
 * transition is to `sent`, must be shown as having no operator move at all
 * rather than an empty control the operator will fiddle with.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { SequenceCard, describeSequenceOutcome, type SequencesData } from './SequenceCard.js';
import type { AtlasGeneratedClient } from '@atlas/client';

const LEAD = 'lead-1';

const PLANNED: SequencesData = {
  available: true,
  channels: ['email', 'sms', 'whatsapp', 'social_dm', 'phone'],
  maxSteps: 4,
  minSpacingHours: 48,
  items: [
    {
      leadId: LEAD,
      businessName: 'Acme Plumbing',
      leadStatus: 'new',
      sequence: {
        sequenceId: 's-1',
        version: 1,
        state: 'active',
        stoppedReason: null,
        touches: [
          {
            touchId: 't-1',
            step: 1,
            channel: 'email',
            state: 'approval_required',
            sentAt: null,
            moves: [{ state: 'approved', requiresApproval: true }],
          },
          {
            touchId: 't-2',
            step: 2,
            channel: 'sms',
            state: 'scheduled',
            sentAt: null,
            moves: [],
          },
        ],
      },
    },
  ],
};

const UNPLANNED: SequencesData = {
  ...PLANNED,
  items: [{ leadId: LEAD, businessName: 'Acme Plumbing', leadStatus: 'new', sequence: null }],
};

function setup(data: SequencesData, result: Record<string, unknown> = {}) {
  const calls: Array<{ method: string; input: Record<string, unknown> }> = [];
  const client = {
    automationSequence: async (input: Record<string, unknown>) => {
      calls.push({ method: 'automationSequence', input });
      return result.plan ?? { planned: true, sequenceId: 's-9', steps: [{ step: 1, channel: 'email' }] };
    },
    sequenceAdvance: async (input: Record<string, unknown>) => {
      calls.push({ method: 'sequenceAdvance', input });
      return (
        result.advance ?? {
          advanced: true,
          from: 'approval_required',
          to: 'approved',
          sequenceState: 'active',
          stopped: false,
        }
      );
    },
  } as unknown as AtlasGeneratedClient;

  const onChanged = vi.fn();
  render(<SequenceCard data={data} client={client} hasSpace onChanged={onChanged} />);
  return { calls, onChanged };
}

describe('describeSequenceOutcome', () => {
  it('says a plan created drafts and approved nothing', () => {
    expect(
      describeSequenceOutcome({ planned: true, steps: [{ step: 1 }, { step: 2 }] }),
    ).toMatch(/Planned 2 touch\(es\) as drafts.*nothing is approved/);
  });

  it('reports a 200 refusal as a refusal', () => {
    expect(
      describeSequenceOutcome({ planned: false, code: 'lead_suppressed', note: 'suppressed' }),
    ).toMatch(/Refused \(lead_suppressed\)/);
    expect(
      describeSequenceOutcome({
        advanced: false,
        code: 'send_not_self_serviceable',
        note: 'only the approved dispatch may send',
      }),
    ).toMatch(/send_not_self_serviceable/);
  });

  it('says when an outcome stopped the whole sequence', () => {
    expect(
      describeSequenceOutcome({
        advanced: true,
        from: 'delivered',
        to: 'replied',
        sequenceState: 'stopped',
        stopped: true,
      }),
    ).toMatch(/sequence is stopped/);
  });
});

describe('SequenceCard', () => {
  it('says planning sends nothing and states the spacing', () => {
    setup(UNPLANNED);
    expect(screen.getByText(/Planning creates drafts only/)).toBeInTheDocument();
    expect(screen.getByText(/48\s*hours apart/)).toBeInTheDocument();
  });

  /** The rule made visible: no control offers `sent`. */
  it('offers no move out of a scheduled touch and says why', () => {
    setup(PLANNED);
    expect(screen.getByTestId('no-moves-t-2')).toHaveTextContent(
      /only the approved outreach\.send dispatch can record a send/,
    );
    expect(screen.queryByTestId('touch-move-t-2')).toBeNull();
  });

  it('never offers sent in any move control', () => {
    setup(PLANNED);
    const select = screen.getByTestId('touch-move-t-1') as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).not.toContain('sent');
  });

  /** A move that needs an approval asks for one before it is sent. */
  it('asks for an approval id only for the move that requires it', async () => {
    setup(PLANNED);
    expect(screen.queryByTestId('touch-approval-t-1')).toBeNull();
    await userEvent.selectOptions(screen.getByTestId('touch-move-t-1'), 'approved');
    expect(screen.getByTestId('touch-approval-t-1')).toBeInTheDocument();
  });

  it('sends the approval id when one is supplied, and omits it when it is not', async () => {
    const { calls } = setup(PLANNED);
    await userEvent.selectOptions(screen.getByTestId('touch-move-t-1'), 'approved');
    await userEvent.type(screen.getByTestId('touch-approval-t-1'), 'appr-1');
    await userEvent.click(screen.getByTestId('touch-advance-t-1'));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].input).toEqual({ touchId: 't-1', state: 'approved', approvalId: 'appr-1' });
  });

  it('omits an empty approval rather than sending a reference that does not exist', async () => {
    const data: SequencesData = {
      ...PLANNED,
      items: [
        {
          ...PLANNED.items![0],
          sequence: {
            ...PLANNED.items![0].sequence!,
            touches: [
              {
                touchId: 't-3',
                step: 1,
                channel: 'email',
                state: 'draft',
                sentAt: null,
                moves: [{ state: 'policy_check', requiresApproval: false }],
              },
            ],
          },
        },
      ],
    };
    const { calls } = setup(data);
    await userEvent.selectOptions(screen.getByTestId('touch-move-t-3'), 'policy_check');
    await userEvent.click(screen.getByTestId('touch-advance-t-3'));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].input).toEqual({ touchId: 't-3', state: 'policy_check' });
  });

  it('plans the chosen channels in the chosen order', async () => {
    const { calls } = setup(UNPLANNED);
    await userEvent.selectOptions(screen.getByTestId(`plan-step-${LEAD}-0`), 'email');
    await userEvent.selectOptions(screen.getByTestId(`plan-step-${LEAD}-1`), 'sms');
    await userEvent.click(screen.getByTestId(`plan-${LEAD}`));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].input).toEqual({ leadId: LEAD, channels: ['email', 'sms'] });
  });

  it('warns that a suppressed lead will be refused', () => {
    setup({
      ...UNPLANNED,
      items: [{ ...UNPLANNED.items![0], leadStatus: 'suppressed' }],
    });
    expect(screen.getByTestId(`suppressed-${LEAD}`)).toHaveTextContent(/will be refused/);
  });

  it('shows why a sequence stopped', () => {
    setup({
      ...PLANNED,
      items: [
        {
          ...PLANNED.items![0],
          sequence: { ...PLANNED.items![0].sequence!, state: 'stopped', stoppedReason: 'replied' },
        },
      ],
    });
    expect(screen.getByTestId(`sequence-state-${LEAD}`)).toHaveTextContent('stopped: replied');
  });

  it('reports an unavailable pipeline instead of an empty one', () => {
    render(
      <SequenceCard
        data={{ available: false, note: 'migrations 0004 to 0006' }}
        client={{} as AtlasGeneratedClient}
        hasSpace
        onChanged={vi.fn()}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('migrations 0004 to 0006');
  });
});
