/**
 * Revenue pilot funnel (docs/specs/p2/revenue-pilot.md).
 *
 * Rendered from the declarative `status.mission_control` payload like every
 * other card — no bespoke fetch.
 *
 * The one rule this component exists to keep: a rate the API reports as null
 * is unknown, and must render as an em dash. Showing "0%" for a stage nothing
 * reached would invite an operator to go and fix messaging that has never been
 * sent, and the API is careful to distinguish the two — it would be a shame to
 * throw that away at the last step.
 */
import React from 'react';
import type { AtlasGeneratedClient } from '@atlas/client';
import styles from './MissionControl.module.css';

export interface FunnelStage {
  id: string;
  label: string;
  count: number;
  conversionPercent: number | null;
  of: string | null;
}

export interface CostRecord {
  minorByCurrency?: Record<string, number>;
  minutesByCategory?: Record<string, number>;
  satisfaction?: number | null;
  satisfactionCount?: number;
  complete?: boolean;
  missingCategories?: string[];
  satisfactionMissing?: boolean;
}

export interface FunnelData {
  available?: boolean;
  note?: string;
  stages?: FunnelStage[];
  rates?: Record<string, number | null>;
  revenue?: { recurringMinorByCurrency?: Record<string, number>; payingCustomers?: number };
  /** The half of the exit criterion that is not the customer. */
  costRecord?: CostRecord;
  grossMarginMinorByCurrency?: Record<string, number> | null;
  grossMarginUnavailableReason?: string | null;
  /** Cost categories, published by the API so the form cannot drop one. */
  costCategories?: string[];
  unavailable?: string[];
  empty?: boolean;
  topBlockers?: Array<{ code: string; count: number }>;
}

/** A percentage, or an em dash when there was no denominator to divide by. */
export function formatRate(value: number | null | undefined): string {
  return typeof value === 'number' ? `${value}%` : '—';
}

/** Minor units to a readable amount. Currencies are never summed together. */
export function formatMoney(minor: number, currency: string): string {
  return `${(minor / 100).toFixed(2)} ${currency}`;
}

const RATE_LABELS: Record<string, string> = {
  qualificationRate: 'Qualified of assessed',
  disqualificationRate: 'Disqualified of assessed',
  reviewBacklogRate: 'Awaiting review',
  deliveryRate: 'Delivered of sent',
  replyRate: 'Replied of delivered',
  optOutRate: 'Opted out of delivered',
  acceptanceRate: 'Accepted of offered',
  activationRate: 'Activated of accepted',
  churnRate: 'Cancelled of ever active',
  endToEndRate: 'Sourced to serving',
};

/**
 * What the API did, including the refusals it reports with a 200.
 *
 * `recorded: false` is a refusal carrying its reason. Reporting only the
 * absence of an exception would show an operator a cost that was never stored.
 */
export function describeRecordOutcome(result: Record<string, unknown>): string {
  if (result.status === 'schema_pending') {
    return `Nothing was recorded — ${String(result.note ?? 'the schema is behind the code')}.`;
  }
  if (result.recorded === false) {
    return `Refused (${String(result.code ?? 'no code')}) — ${String(result.note ?? 'no reason given')}`;
  }
  if (typeof result.entryId === 'string') {
    return `Recorded a ${String(result.category)} cost.`;
  }
  if (typeof result.outcomeId === 'string') {
    return `Recorded satisfaction ${String(result.satisfaction)}.`;
  }
  return `status ${String(result.status ?? 'unknown')}`;
}

const BLANK_COST = { category: '', amountMinor: '', currency: '', minutes: '', note: '', leadId: '' };
const BLANK_OUTCOME = { leadId: '', satisfaction: '', note: '' };

export function FunnelCard({
  data,
  client,
  hasSpace,
  onRecorded,
}: {
  data: FunnelData;
  client?: AtlasGeneratedClient;
  hasSpace?: boolean;
  onRecorded?: () => void;
}): React.ReactElement {
  /*
   * Every hook runs before the unavailable branch returns. React counts hooks
   * per render, so declaring them after an early return makes the count depend
   * on the data — which is a real bug the linter is right about, not noise to
   * be suppressed.
   */
  const [cost, setCost] = React.useState({ ...BLANK_COST });
  const [outcome, setOutcome] = React.useState({ ...BLANK_OUTCOME });
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const inFlight = React.useRef(false);

  const stages = data.stages ?? [];
  const revenue = Object.entries(data.revenue?.recurringMinorByCurrency ?? {});

  /**
   * One governed action at a time.
   *
   * `busy` drives the disabled state but React commits it asynchronously, so
   * two clicks arriving before that commit both used to pass. A duplicated cost
   * entry is a figure counted twice in a record whose whole purpose is being
   * reconcilable.
   */
  const act = React.useCallback(
    async (run: () => Promise<unknown>, reset: () => void) => {
      if (inFlight.current || !hasSpace) return;
      inFlight.current = true;
      setBusy(true);
      setError(null);
      try {
        const result = (await run()) as Record<string, unknown>;
        setNote(describeRecordOutcome(result));
        if (result.recorded === true) reset();
        onRecorded?.();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [hasSpace, onRecorded],
  );

  const today = new Date().toISOString().slice(0, 10);

  if (data.available === false) {
    return (
      <div className={styles.card} data-testid="card-funnel">
        <h3>Revenue pilot funnel</h3>
        <p className={styles.error} role="status">
          {data.note ?? 'The funnel cannot be read.'}
        </p>
      </div>
    );
  }

  return (
    <div className={styles.card} data-testid="card-funnel">
      <h3>
        Revenue pilot funnel{' '}
        <span className={styles.count}>{data.revenue?.payingCustomers ?? 0} paying</span>
      </h3>

      {/* An empty pilot is evidence, not a failure to report. */}
      {data.empty && (
        <p className={styles.when} data-testid="funnel-empty">
          Nothing has entered the funnel yet. Lead sourcing has no directory adapter, so
          every stage below is empty by construction rather than by outcome.
        </p>
      )}

      <table className={styles.table}>
        <tbody>
          {stages.map((s) => (
            <tr key={s.id}>
              <td>{s.label}</td>
              <td>{s.count}</td>
              <td className={styles.when}>
                {s.of === null ? '' : `${formatRate(s.conversionPercent)} of ${s.of}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {revenue.length > 0 && (
        <p className={styles.when} data-testid="funnel-revenue">
          recurring:{' '}
          {revenue.map(([currency, minor]) => formatMoney(minor, currency)).join(' · ')}
        </p>
      )}

      <div className={styles.when} data-testid="funnel-rates">
        {Object.entries(data.rates ?? {}).map(([key, value]) => (
          <p key={key}>
            {RATE_LABELS[key] ?? key}: <code>{formatRate(value)}</code>
          </p>
        ))}
      </div>

      {(data.topBlockers ?? []).length > 0 && (
        <p className={styles.when} data-testid="funnel-blockers">
          top disqualifiers:{' '}
          {(data.topBlockers ?? []).map((b) => `${b.code} (${b.count})`).join(', ')}
        </p>
      )}

      {/*
        Named gaps, not omitted ones. A missing row reads as an oversight; a
        named one reads as a decision that still has to be closed before the
        pilot can claim a complete cost record.
      */}
      {/*
        The cost, support and outcome half of the exit criterion. Money and
        minutes are shown side by side and never added together: no hourly rate
        exists, so a single figure would be invented.
      */}
      {data.costRecord && (
        <div className={styles.when} data-testid="funnel-cost-record">
          <p>
            cost record{' '}
            <strong>{data.costRecord.complete ? 'complete' : 'incomplete'}</strong>
            {data.costRecord.complete && ' — every category has at least one entry, which is a floor rather than proof of thoroughness'}
          </p>
          {Object.entries(data.costRecord.minorByCurrency ?? {}).map(([currency, minor]) => (
            <p key={currency} data-testid={`funnel-cost-${currency}`}>
              recorded cost: {formatMoney(minor, currency)}
            </p>
          ))}
          {Object.entries(data.costRecord.minutesByCategory ?? {}).map(([category, minutes]) => (
            <p key={category} data-testid={`funnel-minutes-${category}`}>
              {category} time: {minutes} min — not priced, so never folded into a total
            </p>
          ))}
          <p data-testid="funnel-satisfaction">
            satisfaction:{' '}
            {typeof data.costRecord.satisfaction === 'number'
              ? `${data.costRecord.satisfaction} from ${data.costRecord.satisfactionCount ?? 0}`
              : '— nobody has been asked'}
          </p>
          {/*
            Margin is withheld rather than estimated. A margin from part of the
            costs is always too high, and the missing figure is exactly the one
            nobody got round to recording.
          */}
          <p data-testid="funnel-margin">
            {data.grossMarginMinorByCurrency
              ? `gross margin: ${Object.entries(data.grossMarginMinorByCurrency)
                  .map(([currency, minor]) => formatMoney(minor, currency))
                  .join(' · ')}`
              : `gross margin: — ${data.grossMarginUnavailableReason ?? 'not available'}`}
          </p>
        </div>
      )}

      {(data.unavailable ?? []).length > 0 && (
        <p className={styles.when} data-testid="funnel-unavailable">
          not measured anywhere yet: {(data.unavailable ?? []).join(', ')}
        </p>
      )}

      {/*
        Recording the other half of the exit criterion. The capabilities existed
        with no operator surface, which is the same gap the twelve P2C
        capabilities shipped with — built, deployed, and drivable only by API.
      */}
      {client && (
        <details className={styles.factRow} data-testid="record-cost">
          <summary>Record a pilot cost or outcome</summary>

          <p className={styles.when}>
            An entry is either an amount or minutes, never both. Nothing converts
            between them, so a total that mixed them would be invented.
          </p>

          <label className={styles.field}>
            <span>Category</span>
            <select
              data-testid="cost-category"
              value={cost.category}
              onChange={(e) => setCost((c) => ({ ...c, category: e.target.value }))}
            >
              <option value="">choose a category…</option>
              {(data.costCategories ?? []).map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.field}>
            <span>Amount in minor units, with currency — or leave blank and use minutes</span>
            <input
              data-testid="cost-amount"
              value={cost.amountMinor}
              onChange={(e) => setCost((c) => ({ ...c, amountMinor: e.target.value }))}
            />
          </label>
          <label className={styles.field}>
            <span>Currency</span>
            <input
              data-testid="cost-currency"
              value={cost.currency}
              onChange={(e) => setCost((c) => ({ ...c, currency: e.target.value }))}
            />
          </label>
          <label className={styles.field}>
            <span>Minutes — for labour and support</span>
            <input
              data-testid="cost-minutes"
              value={cost.minutes}
              onChange={(e) => setCost((c) => ({ ...c, minutes: e.target.value }))}
            />
          </label>
          <label className={styles.field}>
            <span>Lead — blank for a cost that belongs to no single customer</span>
            <input
              data-testid="cost-lead"
              value={cost.leadId}
              onChange={(e) => setCost((c) => ({ ...c, leadId: e.target.value }))}
            />
          </label>
          <label className={styles.field}>
            <span>Note — required, so the figure can be audited later</span>
            <input
              data-testid="cost-note"
              value={cost.note}
              onChange={(e) => setCost((c) => ({ ...c, note: e.target.value }))}
            />
          </label>
          <button
            type="button"
            data-testid="submit-cost"
            disabled={busy}
            onClick={() =>
              void act(
                () =>
                  client.pilotRecordCost({
                    category: cost.category,
                    incurredOn: today,
                    note: cost.note,
                    ...(cost.leadId.trim() === '' ? {} : { leadId: cost.leadId.trim() }),
                    ...(cost.amountMinor.trim() === ''
                      ? {}
                      : { amountMinor: Number(cost.amountMinor) }),
                    ...(cost.currency.trim() === '' ? {} : { currency: cost.currency.trim() }),
                    ...(cost.minutes.trim() === '' ? {} : { minutes: Number(cost.minutes) }),
                  }),
                () => setCost({ ...BLANK_COST }),
              )
            }
          >
            {busy ? 'Recording…' : 'Record cost'}
          </button>

          <p className={styles.when}>
            Satisfaction has no default. An unrecorded score is a gap; a middle value
            would turn “nobody asked” into “they were indifferent”.
          </p>
          <label className={styles.field}>
            <span>Lead</span>
            <input
              data-testid="outcome-lead"
              value={outcome.leadId}
              onChange={(e) => setOutcome((o) => ({ ...o, leadId: e.target.value }))}
            />
          </label>
          <label className={styles.field}>
            <span>Satisfaction, 1 to 5</span>
            <input
              data-testid="outcome-satisfaction"
              value={outcome.satisfaction}
              onChange={(e) => setOutcome((o) => ({ ...o, satisfaction: e.target.value }))}
            />
          </label>
          <label className={styles.field}>
            <span>What it is based on</span>
            <input
              data-testid="outcome-note"
              value={outcome.note}
              onChange={(e) => setOutcome((o) => ({ ...o, note: e.target.value }))}
            />
          </label>
          <button
            type="button"
            data-testid="submit-outcome"
            disabled={busy}
            onClick={() =>
              void act(
                () =>
                  client.pilotRecordOutcome({
                    leadId: outcome.leadId,
                    satisfaction: Number(outcome.satisfaction),
                    observedOn: today,
                    note: outcome.note,
                  }),
                () => setOutcome({ ...BLANK_OUTCOME }),
              )
            }
          >
            {busy ? 'Recording…' : 'Record satisfaction'}
          </button>

          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          {note && (
            <p className={styles.when} data-testid="record-outcome" role="status">
              {note}
            </p>
          )}
        </details>
      )}
    </div>
  );
}
