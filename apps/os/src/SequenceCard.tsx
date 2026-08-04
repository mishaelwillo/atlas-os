/**
 * Outreach sequences (docs/specs/p2/revenue-pilot.md).
 *
 * Rendered from the declarative `status.mission_control` payload; it calls
 * capabilities only to act.
 *
 * The moves offered per touch are the ones the API derived from its own rule
 * function, not a list this file keeps. That is what stops the surface
 * offering `sent`: only the approved `outreach.send` dispatch may record a
 * send, so `scheduled` arrives here with no moves at all, and the card says
 * why rather than showing an empty control.
 *
 * Planning sends nothing. Every touch still needs its own policy check and its
 * own named approval, so the button says "Plan" and the copy says so too.
 */
import React, { useCallback, useState } from 'react';
import type { AtlasGeneratedClient } from '@atlas/client';
import styles from './MissionControl.module.css';

export interface SequenceTouch {
  touchId: string;
  step: number;
  channel: string;
  state: string;
  sentAt: string | null;
  moves: Array<{ state: string; requiresApproval: boolean }>;
}

export interface LeadSequence {
  sequenceId: string;
  version: number;
  state: string;
  stoppedReason: string | null;
  touches: SequenceTouch[];
}

export interface SequenceItem {
  leadId: string;
  businessName: string;
  leadStatus: string;
  sequence: LeadSequence | null;
}

export interface SequencesData {
  available?: boolean;
  note?: string;
  channels?: string[];
  maxSteps?: number;
  minSpacingHours?: number;
  items?: SequenceItem[];
}

/** What the API did, including the refusals it reports with a 200. */
export function describeSequenceOutcome(result: Record<string, unknown>): string {
  if (result.status === 'schema_pending') {
    return `Nothing was recorded — ${String(result.note ?? 'the schema is behind the code')}.`;
  }
  if (result.planned === false || result.advanced === false) {
    return `Refused (${String(result.code ?? 'no code')}) — ${String(result.note ?? 'no reason given')}`;
  }
  if (result.planned === true) {
    const steps = Array.isArray(result.steps) ? result.steps.length : 0;
    return `Planned ${steps} touch(es) as drafts — nothing is approved and nothing is scheduled.`;
  }
  if (result.advanced === true) {
    const stopped = result.stopped === true ? ' · the sequence is stopped' : '';
    return `Recorded ${String(result.from)} → ${String(result.to)} · sequence ${String(
      result.sequenceState,
    )}${stopped}`;
  }
  return `status ${String(result.status ?? 'unknown')}`;
}

export interface SequenceCardProps {
  data: SequencesData;
  client: AtlasGeneratedClient;
  hasSpace: boolean;
  onChanged: () => void;
}

export function SequenceCard({
  data,
  client,
  hasSpace,
  onChanged,
}: SequenceCardProps): React.ReactElement {
  const [plan, setPlan] = useState<Record<string, string[]>>({});
  const [move, setMove] = useState<Record<string, string>>({});
  const [approval, setApproval] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);

  const items = data.items ?? [];
  const channels = data.channels ?? [];
  const maxSteps = data.maxSteps ?? 4;

  const act = useCallback(
    async (run: () => Promise<unknown>) => {
      setError(null);
      setOutcome(null);
      if (!hasSpace) {
        setError('Select a Space first. Every governed action requires one.');
        return;
      }
      setBusy(true);
      try {
        const res = (await run()) as Record<string, unknown>;
        setOutcome(describeSequenceOutcome(res));
        onChanged();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [hasSpace, onChanged],
  );

  if (data.available === false) {
    return (
      <div className={styles.card} data-testid="card-sequences">
        <h3>Outreach sequences</h3>
        <p className={styles.error} role="status">
          {data.note ?? 'The pilot pipeline cannot be read.'}
        </p>
      </div>
    );
  }

  const steps = (leadId: string): string[] => plan[leadId] ?? Array<string>(maxSteps).fill('');

  const setStep = (leadId: string, index: number, channel: string) =>
    setPlan((p) => {
      const next = [...(p[leadId] ?? Array<string>(maxSteps).fill(''))];
      next[index] = channel;
      return { ...p, [leadId]: next };
    });

  return (
    <div className={styles.card} data-testid="card-sequences">
      <h3>
        Outreach sequences <span className={styles.count}>{items.length}</span>
      </h3>
      <p className={styles.when}>
        Planning creates drafts only. Each touch still needs its own approval before
        anything can be sent, and touches are spaced at least {data.minSpacingHours ?? 48}{' '}
        hours apart.
      </p>

      {items.length === 0 && <p className={styles.empty}>No leads to sequence yet.</p>}

      {items.map((item) => (
        <div key={item.leadId} className={styles.factRow} data-testid={`sequence-${item.leadId}`}>
          <div className={styles.factHead}>
            <span className={styles.factNum}>{item.businessName}</span>
            <span className={styles.when}>{item.leadStatus}</span>
          </div>

          {item.leadStatus === 'suppressed' && (
            <p className={styles.error} data-testid={`suppressed-${item.leadId}`}>
              This lead is suppressed. Planning will be refused.
            </p>
          )}

          {item.sequence === null ? (
            <>
              <p className={styles.when}>
                No sequence. Choose the channels in the order they should be attempted; a
                channel may carry at most one touch.
              </p>
              {Array.from({ length: maxSteps }, (_, i) => (
                <label className={styles.field} key={i}>
                  <span>Step {i + 1}</span>
                  <select
                    data-testid={`plan-step-${item.leadId}-${i}`}
                    value={steps(item.leadId)[i] ?? ''}
                    onChange={(e) => setStep(item.leadId, i, e.target.value)}
                  >
                    <option value="">— none —</option>
                    {channels.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
              <button
                type="button"
                data-testid={`plan-${item.leadId}`}
                disabled={busy}
                onClick={() =>
                  void act(() =>
                    client.automationSequence({
                      leadId: item.leadId,
                      channels: steps(item.leadId).filter((c) => c !== ''),
                    }),
                  )
                }
              >
                {busy ? 'Planning…' : 'Plan sequence'}
              </button>
            </>
          ) : (
            <>
              <p className={styles.when} data-testid={`sequence-state-${item.leadId}`}>
                v{item.sequence.version} · {item.sequence.state}
                {item.sequence.stoppedReason && ` · stopped: ${item.sequence.stoppedReason}`}
              </p>
              <table className={styles.table}>
                <tbody>
                  {item.sequence.touches.map((t) => (
                    <tr key={t.touchId} data-testid={`touch-${t.touchId}`}>
                      <td>{t.step}</td>
                      <td>{t.channel}</td>
                      <td>{t.state}</td>
                      <td className={styles.when}>
                        {/* Sent is a fact about an external effect; absent is an em dash. */}
                        {t.sentAt === null ? '—' : new Date(t.sentAt).toLocaleString()}
                      </td>
                      <td>
                        {t.moves.length === 0 ? (
                          <span className={styles.when} data-testid={`no-moves-${t.touchId}`}>
                            {t.state === 'scheduled'
                              ? 'only the approved outreach.send dispatch can record a send'
                              : 'no further move'}
                          </span>
                        ) : (
                          <>
                            <select
                              data-testid={`touch-move-${t.touchId}`}
                              value={move[t.touchId] ?? ''}
                              onChange={(e) =>
                                setMove((m) => ({ ...m, [t.touchId]: e.target.value }))
                              }
                            >
                              <option value="">— record —</option>
                              {t.moves.map((m) => (
                                <option key={m.state} value={m.state}>
                                  {m.state}
                                  {m.requiresApproval ? ' (needs an approval)' : ''}
                                </option>
                              ))}
                            </select>
                            {t.moves.some(
                              (m) => m.requiresApproval && m.state === move[t.touchId],
                            ) && (
                              <input
                                data-testid={`touch-approval-${t.touchId}`}
                                placeholder="approval id"
                                value={approval[t.touchId] ?? ''}
                                onChange={(e) =>
                                  setApproval((a) => ({ ...a, [t.touchId]: e.target.value }))
                                }
                              />
                            )}
                            <button
                              type="button"
                              data-testid={`touch-advance-${t.touchId}`}
                              disabled={busy || !move[t.touchId]}
                              onClick={() =>
                                void act(() =>
                                  client.sequenceAdvance({
                                    touchId: t.touchId,
                                    state: move[t.touchId] ?? '',
                                    // Sent only when supplied: an empty string
                                    // would be offered to the API as an
                                    // approval reference that does not exist.
                                    ...((approval[t.touchId] ?? '').trim() === ''
                                      ? {}
                                      : { approvalId: (approval[t.touchId] ?? '').trim() }),
                                  }),
                                )
                              }
                            >
                              Record
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      ))}

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {outcome && (
        <p className={styles.when} data-testid="sequence-outcome" role="status">
          {outcome}
        </p>
      )}
    </div>
  );
}
