/**
 * Site builder (docs/specs/p2/website-factory.md).
 *
 * The governing rule is that no displayed fact reaches a page without a source.
 * These tests pin what the form sends, because that payload is what the API's
 * sourcing rule then judges.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { SiteBuilderCard, type TemplateOption } from './SiteBuilderCard.js';
import type { AtlasGeneratedClient } from '@atlas/client';

const TEMPLATES: TemplateOption[] = [
  {
    id: 'trades-1',
    vertical: 'trades',
    regions: ['global'],
    requires: ['businessName', 'phone', 'hours'],
    optional: ['tagline', 'email'],
  },
];

function setup(overrides: { hasSpace?: boolean; result?: unknown; fail?: string } = {}) {
  const calls: Array<Record<string, unknown>> = [];
  const client = {
    factoryBuildSite: async (input: Record<string, unknown>) => {
      calls.push(input);
      if (overrides.fail) throw new Error(overrides.fail);
      return overrides.result ?? { siteId: 'site-1', status: 'preview_built', created: true };
    },
  } as unknown as AtlasGeneratedClient;

  const onBuilt = vi.fn();
  render(
    <SiteBuilderCard
      templates={TEMPLATES}
      client={client}
      hasSpace={overrides.hasSpace ?? true}
      onBuilt={onBuilt}
    />,
  );
  return { calls, onBuilt };
}

/** Rows for required fields arrive pre-seeded, so only the value is typed. */
async function fillValue(index: number, value: string, source?: string) {
  await userEvent.type(screen.getByLabelText(`fact ${index} value`), value);
  if (source !== undefined) {
    await userEvent.type(screen.getByLabelText(`fact ${index} source`), source);
  }
}

describe('site builder', () => {
  it('states the sourcing rule up front', () => {
    setup();
    expect(screen.getByText(/Every displayed fact needs a source/i)).toBeInTheDocument();
  });

  it('shows what the chosen template requires', () => {
    setup();
    expect(screen.getByTestId('template-requirements')).toHaveTextContent(
      /businessName, phone, hours/,
    );
  });

  /**
   * The operator should not have to learn the field names. A row per required
   * field arrives ready to fill.
   */
  it('seeds one row per required field', () => {
    setup();
    expect(screen.getByLabelText('fact 1 field')).toHaveValue('businessName');
    expect(screen.getByLabelText('fact 2 field')).toHaveValue('phone');
    expect(screen.getByLabelText('fact 3 field')).toHaveValue('hours');
  });

  /**
   * renderSection only emits fields the template declares, so a typo in a
   * free-text box would be stored and silently never displayed.
   */
  it('offers only fields the template can render', () => {
    setup();
    const options = within(screen.getByLabelText('fact 1 field'))
      .getAllByRole('option')
      .map((o) => (o as HTMLOptionElement).value)
      .filter((v) => v !== '');
    expect(options).toEqual(['businessName', 'phone', 'hours', 'tagline', 'email']);
  });

  /** Naming the gap while entering beats discovering it after a refusal. */
  it('names the facts still missing for the template', () => {
    setup();
    expect(screen.getByTestId('missing-facts')).toHaveTextContent(/phone/);
    expect(screen.getByTestId('missing-facts')).toHaveTextContent(/hours/);
  });

  /**
   * A named field with no value is not sent, so it is not supplied. Counting it
   * would tell the operator they were done while the API saw nothing.
   */
  it('still names a seeded field that has no value', () => {
    setup();
    expect(screen.getByTestId('missing-facts')).toHaveTextContent(/businessName/);
  });

  it('stops naming a fact once it has a value', async () => {
    setup();
    await fillValue(2, '555', 'https://x.example');
    await waitFor(() =>
      expect(screen.getByTestId('missing-facts')).not.toHaveTextContent(/phone/),
    );
  });

  /** An unsourced fact is accepted but never rendered; say so before building. */
  it('warns about a fact with a value and no source', async () => {
    setup();
    await fillValue(1, 'Acme');
    await waitFor(() =>
      expect(screen.getByTestId('unsourced-facts')).toHaveTextContent(/businessName/),
    );
  });

  it('clears the warning once a source is given', async () => {
    setup();
    await fillValue(1, 'Acme', 'https://maps.example/acme');
    await waitFor(() => expect(screen.queryByTestId('unsourced-facts')).toBeNull());
  });

  it('sends a sourced fact with its source url', async () => {
    const { calls } = setup();
    await userEvent.type(screen.getByTestId('profile-url'), 'https://maps.example/acme');
    await fillValue(1, 'Acme', 'https://maps.example/acme');
    await userEvent.click(screen.getByTestId('build-site'));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].facts).toEqual([
      { field: 'businessName', value: 'Acme', sourceUrl: 'https://maps.example/acme' },
    ]);
  });

  /**
   * Owner-provided and sourced are mutually exclusive on the wire; sending both
   * would let a blank source ride along with the owner marker.
   */
  it('sends an owner-provided fact without a source url', async () => {
    const { calls } = setup();
    await userEvent.type(screen.getByTestId('profile-url'), 'https://maps.example/acme');
    await userEvent.click(screen.getByTestId('add-fact'));
    await userEvent.selectOptions(screen.getByLabelText('fact 4 field'), 'tagline');
    await fillValue(4, 'Fast and fair');
    await userEvent.click(screen.getByLabelText('fact 4 owner provided'));
    await userEvent.click(screen.getByTestId('build-site'));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].facts).toEqual([
      { field: 'tagline', value: 'Fast and fair', ownerProvided: true },
    ]);
  });

  it('hides the source field once a fact is owner-provided', async () => {
    setup();
    await userEvent.click(screen.getByLabelText('fact 1 owner provided'));
    expect(screen.queryByLabelText('fact 1 source')).toBeNull();
  });

  it('drops rows with no value rather than sending blanks', async () => {
    const { calls } = setup();
    await userEvent.type(screen.getByTestId('profile-url'), 'https://maps.example/acme');
    await fillValue(1, 'Acme', 'https://maps.example/acme');
    await userEvent.click(screen.getByTestId('build-site'));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].facts).toHaveLength(1);
  });

  it('removes a row on request', async () => {
    setup();
    await userEvent.click(screen.getByLabelText('remove fact 3'));
    expect(screen.queryByLabelText('fact 3 field')).toBeNull();
  });

  it('refuses without a profile url', async () => {
    const { calls } = setup();
    await userEvent.click(screen.getByTestId('build-site'));

    expect(calls).toHaveLength(0);
    expect(screen.getByRole('alert')).toHaveTextContent(/profile URL is required/i);
  });

  it('refuses without a selected space', async () => {
    const { calls } = setup({ hasSpace: false });
    await userEvent.type(screen.getByTestId('profile-url'), 'https://maps.example/acme');
    await userEvent.click(screen.getByTestId('build-site'));

    expect(calls).toHaveLength(0);
    expect(screen.getByRole('alert')).toHaveTextContent(/Select a Space/i);
  });

  /** The API's gaps must reach the operator, not be swallowed by a success. */
  it('reports blocked facts returned by the API', async () => {
    setup({
      result: {
        siteId: 'site-1',
        status: 'descriptor_draft_with_gaps',
        created: true,
        blocked: [{ field: 'phone', reason: 'unsourced' }],
      },
    });
    await userEvent.type(screen.getByTestId('profile-url'), 'https://maps.example/acme');
    await fillValue(1, 'Acme', 'https://maps.example/acme');
    await userEvent.click(screen.getByTestId('build-site'));

    await waitFor(() =>
      expect(screen.getByTestId('build-blocked')).toHaveTextContent(/phone \(unsourced\)/),
    );
  });

  it('says plainly when nothing was created', async () => {
    setup({ result: { status: 'facts_pending_review', created: false } });
    await userEvent.type(screen.getByTestId('profile-url'), 'https://maps.example/acme');
    await fillValue(1, 'Acme');
    await userEvent.click(screen.getByTestId('build-site'));

    await waitFor(() =>
      expect(within(screen.getByTestId('build-result')).getByText(/nothing was created/i))
        .toBeInTheDocument(),
    );
  });

  it('surfaces a failed request', async () => {
    setup({ fail: 'Atlas API error 409' });
    await userEvent.type(screen.getByTestId('profile-url'), 'https://maps.example/acme');
    await fillValue(1, 'Acme', 'https://maps.example/acme');
    await userEvent.click(screen.getByTestId('build-site'));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/409/));
  });
});
