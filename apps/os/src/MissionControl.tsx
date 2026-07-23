/**
 * Mission Control — declarative cards rendered from status.mission_control
 * JSON (brief §5): no bespoke per-card fetches. Polls every 5s via the
 * generated client. Approvals card: approve / reject / defer (radio-style)
 * with notes per item.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createGeneratedClient, type AtlasGeneratedClient } from '@atlas/client';
import styles from './MissionControl.module.css';

const POLL_MS = 5000;

// ---- shapes of the declarative card payloads (server: handlers/status.ts) ----
interface ApprovalItem {
  approvalId: string;
  kind: string;
  reason: string;
  payload: unknown;
  createdAt: string;
}
interface RunItem {
  runId: string;
  capability: string;
  taskClass: string;
  status: string;
  model: string | null;
  answeredBy: string | null;
  costUsd: number;
  createdAt: string;
}
interface StatusCard {
  id: string;
  kind: 'approvals' | 'runs' | 'model_chain' | 'cache' | 'schedules';
  title: string;
  data: Record<string, unknown>;
}
interface MissionControlPayload {
  ok: boolean;
  generatedAt: string;
  cards: StatusCard[];
}

type Decision = 'approved' | 'rejected' | 'defer';

function useToken(): [string, (t: string) => void] {
  const [token, setTokenState] = useState<string>(() => localStorage.getItem('atlas.token') ?? '');
  const setToken = useCallback((t: string) => {
    localStorage.setItem('atlas.token', t);
    setTokenState(t);
  }, []);
  return [token, setToken];
}

function ApprovalsCard({ card, client, onDecided }: { card: StatusCard; client: AtlasGeneratedClient; onDecided: () => void }) {
  const items = (card.data.items ?? []) as ApprovalItem[];
  const [choice, setChoice] = useState<Record<string, Decision>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [deferred, setDeferred] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  const submit = async (item: ApprovalItem) => {
    const decision = choice[item.approvalId];
    if (!decision) return;
    if (decision === 'defer') {
      // defer = leave pending, hide locally until next session
      setDeferred((d) => ({ ...d, [item.approvalId]: true }));
      return;
    }
    setBusy((b) => ({ ...b, [item.approvalId]: true }));
    setError(null);
    try {
      await client.approvalsDecide({ approvalId: item.approvalId, decision, notes: notes[item.approvalId] ?? '' });
      onDecided();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy((b) => ({ ...b, [item.approvalId]: false }));
    }
  };

  const visible = items.filter((i) => !deferred[i.approvalId]);
  return (
    <div className={styles.card} data-testid="card-approvals">
      <h3>
        {card.title} <span className={styles.count}>{visible.length}</span>
      </h3>
      {error && <p className={styles.error}>{error}</p>}
      {visible.length === 0 && <p className={styles.empty}>Queue clear — nothing waiting on you.</p>}
      {visible.map((item) => (
        <div key={item.approvalId} className={styles.approvalItem}>
          <div className={styles.approvalHead}>
            <code className={styles.kind}>{item.kind}</code>
            <span className={styles.when}>{new Date(item.createdAt).toLocaleString()}</span>
          </div>
          <p className={styles.reason}>{item.reason}</p>
          <details className={styles.payload}>
            <summary>payload</summary>
            <pre>{JSON.stringify(item.payload, null, 2)}</pre>
          </details>
          <div className={styles.decisionRow} role="radiogroup" aria-label={`decision for ${item.approvalId}`}>
            {(['approved', 'rejected', 'defer'] as const).map((d) => (
              <label key={d} className={styles.radio}>
                <input
                  type="radio"
                  name={`decision-${item.approvalId}`}
                  checked={choice[item.approvalId] === d}
                  onChange={() => setChoice((c) => ({ ...c, [item.approvalId]: d }))}
                />
                {d === 'approved' ? 'Approve' : d === 'rejected' ? 'Reject' : 'Defer'}
              </label>
            ))}
          </div>
          <div className={styles.notesRow}>
            <input
              type="text"
              placeholder="notes (recorded on the approval)"
              value={notes[item.approvalId] ?? ''}
              onChange={(e) => setNotes((n) => ({ ...n, [item.approvalId]: e.target.value }))}
            />
            <button disabled={!choice[item.approvalId] || busy[item.approvalId]} onClick={() => void submit(item)}>
              {busy[item.approvalId] ? '…' : 'Submit'}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function RunsCard({ card }: { card: StatusCard }) {
  const items = (card.data.items ?? []) as RunItem[];
  return (
    <div className={styles.card} data-testid="card-runs">
      <h3>{card.title}</h3>
      {items.length === 0 && <p className={styles.empty}>No runs yet.</p>}
      <table className={styles.table}>
        <tbody>
          {items.map((r) => (
            <tr key={r.runId}>
              <td><code>{r.capability}</code></td>
              <td><span className={`${styles.status} ${styles['status_' + r.status] ?? ''}`}>{r.status}</span></td>
              <td>{r.model ?? r.answeredBy ?? '—'}</td>
              <td>${r.costUsd.toFixed(4)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ModelChainCard({ card }: { card: StatusCard }) {
  const chains = (card.data.chains ?? {}) as Record<string, string[]>;
  const failures = (card.data.failures24h ?? []) as Array<{ model: string; count: number }>;
  return (
    <div className={styles.card} data-testid="card-models">
      <h3>{card.title}</h3>
      {Object.entries(chains).map(([cls, models]) => (
        <p key={cls} className={styles.chainRow}>
          <strong>{cls}</strong>: {models.join(' → ')}
        </p>
      ))}
      {failures.length > 0 && (
        <p className={styles.error}>failures 24h: {failures.map((f) => `${f.model} ×${f.count}`).join(', ')}</p>
      )}
    </div>
  );
}

function CacheCard({ card }: { card: StatusCard }) {
  const rate = Number(card.data.cacheHitRate ?? 0);
  const saved = Number(card.data.dollarsSavedUsd ?? 0);
  const rungs = (card.data.rungCounts ?? {}) as Record<string, number>;
  return (
    <div className={styles.card} data-testid="card-cache">
      <h3>{card.title}</h3>
      <div className={styles.bigNumbers}>
        <div>
          <span className={styles.big}>{(rate * 100).toFixed(1)}%</span>
          <span className={styles.label}>cache-hit rate</span>
        </div>
        <div>
          <span className={styles.big}>${saved.toFixed(2)}</span>
          <span className={styles.label}>saved</span>
        </div>
      </div>
      <p className={styles.chainRow}>
        rungs: {Object.entries(rungs).map(([k, v]) => `${k}:${v}`).join('  ') || '—'}
      </p>
    </div>
  );
}

function SchedulesCard({ card }: { card: StatusCard }) {
  const items = (card.data.items ?? []) as Array<{ scheduleId: string; capability: string; cron: string; iterationCap: number; lastRunAt: string | null }>;
  return (
    <div className={styles.card} data-testid="card-schedules">
      <h3>{card.title}</h3>
      {items.length === 0 && <p className={styles.empty}>No enabled schedules.</p>}
      {items.map((s) => (
        <p key={s.scheduleId} className={styles.chainRow}>
          <code>{s.capability}</code> — <code>{s.cron}</code> (cap {s.iterationCap})
          {s.lastRunAt ? ` · last ${new Date(s.lastRunAt).toLocaleTimeString()}` : ''}
        </p>
      ))}
    </div>
  );
}

export function MissionControlLive() {
  const apiUrl = ((import.meta.env.VITE_API_URL as string | undefined) || 'http://localhost:3000').replace(/\/$/, '');
  const [token, setToken] = useToken();
  const client = useMemo(() => createGeneratedClient({ baseUrl: apiUrl, token: token || undefined }), [apiUrl, token]);
  const [payload, setPayload] = useState<MissionControlPayload | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = (await client.statusMissionControl({})) as unknown as MissionControlPayload;
      setPayload(res);
      setFetchError(null);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : String(err));
    }
  }, [client]);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  return (
    <div>
      <div className={styles.toolbar}>
        <input
          className={styles.tokenInput}
          type="password"
          placeholder="operator JWT / api token"
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
        {payload && <span className={styles.when}>updated {new Date(payload.generatedAt).toLocaleTimeString()}</span>}
      </div>
      {fetchError && <p className={styles.error}>status fetch failed: {fetchError}</p>}
      <div className={styles.cardGrid}>
        {(payload?.cards ?? []).map((card) => {
          switch (card.kind) {
            case 'approvals':
              return <ApprovalsCard key={card.id} card={card} client={client} onDecided={() => void refresh()} />;
            case 'runs':
              return <RunsCard key={card.id} card={card} />;
            case 'model_chain':
              return <ModelChainCard key={card.id} card={card} />;
            case 'cache':
              return <CacheCard key={card.id} card={card} />;
            case 'schedules':
              return <SchedulesCard key={card.id} card={card} />;
            default:
              return (
                <div key={card.id} className={styles.card}>
                  <h3>{card.title}</h3>
                  <pre>{JSON.stringify(card.data, null, 2)}</pre>
                </div>
              );
          }
        })}
      </div>
    </div>
  );
}
