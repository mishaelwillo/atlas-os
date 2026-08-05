/**
 * Offers, deal decisions and hosting (docs/specs/p2/revenue-pilot.md).
 *
 * Rendered from the declarative `status.mission_control` payload; it calls
 * capabilities only to act.
 *
 * Three things this component refuses to smooth over:
 *
 * 1. **No default price and no default currency.** The fields start empty and
 *    an empty price is refused here by name. Zero is a real price — the pitch
 *    is a free site with hosting-only payment — so it must be possible to send
 *    it, and it must not be possible to send it by accident.
 *
 * 2. **Activation and cancellation are approvals, not actions.** Both come back
 *    as an approval id, and the copy says nothing has been activated. A button
 *    that reported success here would tell an operator a customer was live
 *    while the approval still sat in the queue.
 *
 * 3. **Atlas never confirms a payment.** The card reports only whether a
 *    provider reference exists, because that is all `hosting.state` returns.
 */
import React, { useCallback, useRef, useState } from 'react';
import type { AtlasGeneratedClient } from '@atlas/client';
import styles from './MissionControl.module.css';

export interface RevenueOffer {
  offerId: string;
  version: number;
  country: string;
  currency: string;
  priceMinor: number;
  period: string;
  termsVersion: string;
}

export interface RevenueDeal {
  state: string;
  offerVersion: number | null;
  decidedAt: string;
}

export interface RevenueEntitlement {
  entitlementId: string;
  state: string;
  offerVersion: number;
  paymentRecorded: boolean;
  renewalEnabled: boolean;
  entitled: boolean;
  activatedAt: string | null;
  cancelledAt: string | null;
  servesUntil: string | null;
}

export interface RevenueItem {
  leadId: string;
  businessName: string;
  offer: RevenueOffer | null;
  deal: RevenueDeal | null;
  /** Derived by the API from planDealTransition; empty means decided. */
  dealMoves?: string[];
  entitlement: RevenueEntitlement | null;
}

export interface RevenueOpsData {
  available?: boolean;
  note?: string;
  dealStates?: string[];
  periods?: string[];
  requiredDisclosures?: string[];
  items?: RevenueItem[];
}

/** Minor units to a readable amount. Currencies are never summed together. */
export function formatPrice(minor: number, currency: string): string {
  return `${(minor / 100).toFixed(2)} ${currency}`;
}

/**
 * What the API did.
 *
 * An approval-gated capability answers with an approval id and `review`. That
 * is not an activation, and saying otherwise is the failure this wording
 * exists to prevent.
 */
export function describeRevenueOutcome(result: Record<string, unknown>): string {
  if (result.status === 'schema_pending') {
    return `Nothing was recorded — ${String(result.note ?? 'the schema is behind the code')}.`;
  }
  if (result.status === 'review' || typeof result.approvalId === 'string') {
    return `Queued for approval as ${String(result.approvalId).slice(
      0,
      8,
    )} — nothing has been activated or cancelled. Decide it in Pending approvals.`;
  }
  if (result.published === false || result.decided === false) {
    const missing = Array.isArray(result.missing) && result.missing.length > 0
      ? ` · missing: ${(result.missing as string[]).join(', ')}`
      : '';
    return `Refused (${String(result.code ?? 'no code')}) — ${String(
      result.note ?? 'no reason given',
    )}${missing}`;
  }
  if (result.published === true) {
    const supersedes =
      typeof result.supersedes === 'number' ? ` · supersedes v${result.supersedes}` : '';
    return `Published offer v${String(result.version)} at ${formatPrice(
      Number(result.priceMinor),
      String(result.currency),
    )} ${String(result.period)}${supersedes}`;
  }
  if (result.decided === true) {
    const version =
      result.offerVersion === null || result.offerVersion === undefined
        ? 'no offer version'
        : `offer v${String(result.offerVersion)}`;
    return `Recorded ${String(result.from)} → ${String(result.to)} · ${version}`;
  }
  return `status ${String(result.status ?? 'unknown')}`;
}

interface OfferForm {
  country: string;
  currency: string;
  /** Kept as text so "not entered" stays distinguishable from zero. */
  priceMinor: string;
  period: string;
  termsVersion: string;
  disclosures: Record<string, string>;
}

function blankOffer(periods: string[], required: string[]): OfferForm {
  return {
    country: '',
    currency: '',
    priceMinor: '',
    period: periods[0] ?? '',
    termsVersion: '',
    disclosures: Object.fromEntries(required.map((d) => [d, ''])),
  };
}

export interface RevenueOpsCardProps {
  data: RevenueOpsData;
  client: AtlasGeneratedClient;
  hasSpace: boolean;
  onChanged: () => void;
}

export function RevenueOpsCard({
  data,
  client,
  hasSpace,
  onChanged,
}: RevenueOpsCardProps): React.ReactElement {
  const periods = data.periods ?? [];
  const required = data.requiredDisclosures ?? [];
  const dealStates = data.dealStates ?? [];
  const items = data.items ?? [];

  const [openLead, setOpenLead] = useState<string | null>(null);
  const [offer, setOffer] = useState<OfferForm>(() => blankOffer(periods, required));
  const [deal, setDeal] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);

  /*
   * One governed action at a time.
   *
   * `busy` drives the disabled state, but React commits it asynchronously, so
   * two events arriving before that commit both pass the check. A ref flips
   * synchronously and closes that window. It matters most here because these
   * capabilities are not idempotent: a duplicated publish creates a second
   * immutable offer VERSION, which is a different offer for the customer to
   * have accepted — two were created 473ms apart while running the pilot
   * through a browser.
   */
  const inFlight = useRef(false);

  const act = useCallback(
    async (run: () => Promise<unknown>) => {
      setError(null);
      setOutcome(null);
      if (!hasSpace) {
        setError('Select a Space first. Every governed action requires one.');
        return;
      }
      // Taken only once the call is certain to run, so a refusal above cannot
      // leave the lock held and wedge every later action.
      if (inFlight.current) return;
      inFlight.current = true;
      setBusy(true);
      try {
        const res = (await run()) as Record<string, unknown>;
        setOutcome(describeRevenueOutcome(res));
        onChanged();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [hasSpace, onChanged],
  );

  if (data.available === false) {
    return (
      <div className={styles.card} data-testid="card-revenue-ops">
        <h3>Offers, deals and hosting</h3>
        <p className={styles.error} role="status">
          {data.note ?? 'The pilot pipeline cannot be read.'}
        </p>
      </div>
    );
  }

  const missingDisclosures = required.filter((d) => (offer.disclosures[d] ?? '').trim() === '');

  const publish = (leadId: string) => {
    // Blank is refused here by name. The API would refuse it too, but sending
    // a NaN price to find that out would be a worse way to learn it.
    if (offer.priceMinor.trim() === '') {
      setError('A price is required. Zero is a real price; blank is not.');
      return;
    }
    void act(() =>
      client.offersPublish({
        leadId,
        country: offer.country.trim().toUpperCase(),
        currency: offer.currency.trim().toUpperCase(),
        priceMinor: Number(offer.priceMinor),
        period: offer.period,
        termsVersion: offer.termsVersion.trim(),
        disclosures: offer.disclosures,
      }),
    );
  };

  return (
    <div className={styles.card} data-testid="card-revenue-ops">
      <h3>
        Offers, deals and hosting <span className={styles.count}>{items.length}</span>
      </h3>
      <p className={styles.when}>
        Hosting cannot activate before terms are accepted on the same offer version and a
        provider payment reference is recorded. Atlas never confirms a payment itself.
      </p>

      {items.length === 0 && <p className={styles.empty}>No leads yet.</p>}

      {items.map((item) => (
        <div key={item.leadId} className={styles.factRow} data-testid={`revenue-${item.leadId}`}>
          <div className={styles.factHead}>
            <span className={styles.factNum}>{item.businessName}</span>
          </div>

          <table className={styles.table}>
            <tbody>
              <tr>
                <td>offer</td>
                <td data-testid={`offer-${item.leadId}`}>
                  {/* No offer is an em dash, never a zero price. */}
                  {item.offer === null ? (
                    <span className={styles.when}>—</span>
                  ) : (
                    <>
                      v{item.offer.version} ·{' '}
                      {formatPrice(item.offer.priceMinor, item.offer.currency)} ·{' '}
                      {item.offer.period} · {item.offer.country} · terms{' '}
                      {item.offer.termsVersion}
                    </>
                  )}
                </td>
              </tr>
              <tr>
                <td>deal</td>
                <td data-testid={`deal-${item.leadId}`}>
                  {item.deal === null ? (
                    <span className={styles.when}>—</span>
                  ) : (
                    <>
                      {item.deal.state}
                      {item.deal.offerVersion === null
                        ? ''
                        : ` · on offer v${item.deal.offerVersion}`}
                    </>
                  )}
                </td>
              </tr>
              <tr>
                <td>hosting</td>
                <td data-testid={`entitlement-${item.leadId}`}>
                  {item.entitlement === null ? (
                    <span className={styles.when}>—</span>
                  ) : (
                    <>
                      {item.entitlement.state}
                      {item.entitlement.entitled ? ' · serving' : ' · not serving'}
                      {item.entitlement.paymentRecorded
                        ? ' · payment reference recorded'
                        : ' · no payment reference'}
                      {item.entitlement.renewalEnabled ? '' : ' · renewal off'}
                      {item.entitlement.servesUntil &&
                        ` · serves until ${new Date(
                          item.entitlement.servesUntil,
                        ).toLocaleDateString()}`}
                    </>
                  )}
                </td>
              </tr>
            </tbody>
          </table>

          <div className={styles.buttonRow}>
            {/*
              The moves come from the payload, which the API derived from
              planDealTransition — the same way the demo queue and the outreach
              touches do it. This control used to offer all five deal states
              and leave the API to refuse four of them, so `offer_review` from
              `interested` looked legitimate and came back refused.
            */}
            {(item.dealMoves ?? dealStates).length === 0 ? (
              <span className={styles.when} data-testid={`no-deal-moves-${item.leadId}`}>
                this deal is decided — no further move
              </span>
            ) : (
              <select
                data-testid={`deal-state-${item.leadId}`}
                value={deal[item.leadId] ?? ''}
                onChange={(e) => setDeal((d) => ({ ...d, [item.leadId]: e.target.value }))}
              >
                <option value="">— record a decision —</option>
                {(item.dealMoves ?? dealStates).map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            )}
            <input
              data-testid={`deal-notes-${item.leadId}`}
              placeholder="notes"
              value={notes[item.leadId] ?? ''}
              onChange={(e) => setNotes((n) => ({ ...n, [item.leadId]: e.target.value }))}
            />
            <button
              type="button"
              data-testid={`decide-${item.leadId}`}
              disabled={busy || !deal[item.leadId]}
              onClick={() =>
                void act(() =>
                  client.dealsDecide({
                    leadId: item.leadId,
                    state: deal[item.leadId] ?? '',
                    ...((notes[item.leadId] ?? '').trim() === ''
                      ? {}
                      : { notes: (notes[item.leadId] ?? '').trim() }),
                  }),
                )
              }
            >
              Record decision
            </button>
          </div>

          <div className={styles.buttonRow}>
            <button
              type="button"
              data-testid={`offer-form-${item.leadId}`}
              onClick={() => {
                setOpenLead(openLead === item.leadId ? null : item.leadId);
                setOffer(blankOffer(periods, required));
              }}
            >
              {openLead === item.leadId ? 'Close offer' : 'New offer version'}
            </button>
            <button
              type="button"
              data-testid={`activate-${item.leadId}`}
              disabled={busy}
              onClick={() => void act(() => client.hostingActivate({ leadId: item.leadId }))}
            >
              Request activation
            </button>
            <button
              type="button"
              data-testid={`cancel-${item.leadId}`}
              disabled={busy}
              onClick={() => void act(() => client.hostingCancel({ leadId: item.leadId }))}
            >
              Request cancellation
            </button>
          </div>

          {openLead === item.leadId && (
            <div data-testid={`offer-fields-${item.leadId}`}>
              <p className={styles.when}>
                An offer is never edited — this publishes a new version. Every disclosure
                below must carry text before hosting can activate.
              </p>
              <label className={styles.field}>
                <span>Country (ISO 2-letter)</span>
                <input
                  data-testid="offer-country"
                  value={offer.country}
                  onChange={(e) => setOffer((o) => ({ ...o, country: e.target.value }))}
                />
              </label>
              <label className={styles.field}>
                <span>Currency (ISO 3-letter) — there is no default</span>
                <input
                  data-testid="offer-currency"
                  value={offer.currency}
                  onChange={(e) => setOffer((o) => ({ ...o, currency: e.target.value }))}
                />
              </label>
              <label className={styles.field}>
                <span>Price in minor units — 0 is a real price, blank is not</span>
                <input
                  data-testid="offer-price"
                  type="number"
                  value={offer.priceMinor}
                  onChange={(e) => setOffer((o) => ({ ...o, priceMinor: e.target.value }))}
                />
              </label>
              <label className={styles.field}>
                <span>Period</span>
                <select
                  data-testid="offer-period"
                  value={offer.period}
                  onChange={(e) => setOffer((o) => ({ ...o, period: e.target.value }))}
                >
                  {periods.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.field}>
                <span>Terms version</span>
                <input
                  data-testid="offer-terms"
                  value={offer.termsVersion}
                  onChange={(e) => setOffer((o) => ({ ...o, termsVersion: e.target.value }))}
                />
              </label>

              {required.map((d) => (
                <label className={styles.field} key={d}>
                  <span>{d}</span>
                  <input
                    data-testid={`disclosure-${d}`}
                    value={offer.disclosures[d] ?? ''}
                    onChange={(e) =>
                      setOffer((o) => ({
                        ...o,
                        disclosures: { ...o.disclosures, [d]: e.target.value },
                      }))
                    }
                  />
                </label>
              ))}

              {missingDisclosures.length > 0 && (
                <p className={styles.error} data-testid="missing-disclosures">
                  still needed: {missingDisclosures.join(', ')}
                </p>
              )}

              <button
                type="button"
                data-testid={`publish-${item.leadId}`}
                disabled={busy}
                onClick={() => publish(item.leadId)}
              >
                {busy ? 'Publishing…' : 'Publish offer version'}
              </button>
            </div>
          )}
        </div>
      ))}

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {outcome && (
        <p className={styles.when} data-testid="revenue-outcome" role="status">
          {outcome}
        </p>
      )}
    </div>
  );
}
