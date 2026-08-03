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
import styles from './MissionControl.module.css';

export interface FunnelStage {
  id: string;
  label: string;
  count: number;
  conversionPercent: number | null;
  of: string | null;
}

export interface FunnelData {
  available?: boolean;
  note?: string;
  stages?: FunnelStage[];
  rates?: Record<string, number | null>;
  revenue?: { recurringMinorByCurrency?: Record<string, number>; payingCustomers?: number };
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

export function FunnelCard({ data }: { data: FunnelData }): React.ReactElement {
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

  const stages = data.stages ?? [];
  const revenue = Object.entries(data.revenue?.recurringMinorByCurrency ?? {});

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
      {(data.unavailable ?? []).length > 0 && (
        <p className={styles.when} data-testid="funnel-unavailable">
          not measured anywhere yet: {(data.unavailable ?? []).join(', ')}
        </p>
      )}
    </div>
  );
}
