/**
 * Mission Control — declarative cards rendered from status.mission_control
 * JSON (brief §5): no bespoke per-card fetches. Polls every 5s via the
 * generated client. Approvals card: approve / reject / defer (radio-style)
 * with notes per item.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createGeneratedClient, type AtlasGeneratedClient } from '@atlas/client';
import styles from './MissionControl.module.css';
import { SignIn } from './SignIn.js';
import {
  SIGNED_OUT,
  clearLegacyToken,
  getSupabase,
  listSpaces,
  readStoredSpace,
  toOperatorSession,
  writeStoredSpace,
  type OperatorSession,
  type SpaceOption,
} from './session.js';

/** Must match the pinned address in apps/api/src/env.ts and is_operator(). */
const OPERATOR_EMAIL =
  ((import.meta.env.VITE_OPERATOR_EMAIL as string | undefined) ?? '').trim() ||
  'mobiledynamic876@gmail.com';

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
  kind: 'approvals' | 'runs' | 'model_chain' | 'cache' | 'schedules' | 'memory' | 'deployment';
  title: string;
  data: Record<string, unknown>;
}
interface MissionControlPayload {
  ok: boolean;
  generatedAt: string;
  cards: StatusCard[];
}

type Decision = 'approved' | 'rejected' | 'defer';

/**
 * Operator session state. The pre-session `atlas.token` key is cleared on
 * mount so a stale pasted credential cannot outlive the upgrade and keep
 * granting access.
 */
function useOperatorSession(): {
  session: OperatorSession;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
} {
  const [session, setSession] = useState<OperatorSession>({
    status: 'loading',
    email: null,
    accessToken: null,
    error: null,
  });

  useEffect(() => {
    clearLegacyToken(localStorage);
    const supabase = getSupabase();
    if (!supabase) {
      setSession({
        status: 'unavailable',
        email: null,
        accessToken: null,
        error: 'Supabase identity is not configured in this build.',
      });
      return;
    }
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (active) setSession(toOperatorSession(data.session, OPERATOR_EMAIL));
    });
    // Covers refresh and expiry: the SDK re-emits on both, so an expired
    // access token renews without interrupting the operator.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      if (active) setSession(toOperatorSession(next, OPERATOR_EMAIL));
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const supabase = getSupabase();
    if (!supabase) return;
    setSession((s) => ({ ...s, status: 'authenticating', error: null }));
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setSession({ status: 'signed_out', email: null, accessToken: null, error: error.message });
      return;
    }
    setSession(toOperatorSession(data.session, OPERATOR_EMAIL));
  }, []);

  const signOut = useCallback(async () => {
    const supabase = getSupabase();
    writeStoredSpace(localStorage, null);
    clearLegacyToken(localStorage);
    if (supabase) await supabase.auth.signOut();
    setSession(SIGNED_OUT);
  }, []);

  return { session, signIn, signOut };
}

function ApprovalsCard({ card, client, onDecided, hasSpace }: { card: StatusCard; client: AtlasGeneratedClient; onDecided: () => void; hasSpace: boolean }) {
  const items = (card.data.items ?? []) as ApprovalItem[];
  const [choice, setChoice] = useState<Record<string, Decision>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [deferred, setDeferred] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  const submit = async (item: ApprovalItem) => {
    const decision = choice[item.approvalId];
    if (!decision) return;
    // Block before sending: the API would reject this for want of a Space, and
    // a local message names the actual cause instead of surfacing a 400.
    if (!hasSpace) {
      setError('Select a Space before deciding an approval.');
      return;
    }
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

interface DeploymentFinding {
  code: string;
  severity: 'blocking' | 'unknown';
  message: string;
}

/**
 * Deployment fingerprint versus observed database state. Findings are rendered
 * prominently rather than as data, because a stale schema claim is exactly the
 * kind of thing that goes unnoticed when it is one field among many.
 */
function DeploymentCard({ card }: { card: StatusCard }) {
  const service = (card.data.service ?? {}) as Record<string, unknown>;
  const observed = card.data.observedMigration as string | null;
  const findings = (card.data.findings ?? []) as DeploymentFinding[];

  return (
    <div className={styles.card} data-testid="card-deployment">
      <h3>{card.title}</h3>
      {findings.length === 0 && <p className={styles.empty}>Deployment and database agree.</p>}
      {findings.map((f) => (
        <p
          key={f.code}
          className={styles.error}
          role={f.severity === 'blocking' ? 'alert' : undefined}
          data-testid={`finding-${f.severity}`}
        >
          <strong>{f.severity === 'blocking' ? 'DRIFT' : 'UNKNOWN'}</strong> {f.message}
        </p>
      ))}
      <table className={styles.table}>
        <tbody>
          <tr><td>commit</td><td><code>{String(service.gitSha ?? 'unknown')}</code></td></tr>
          <tr><td>schema claimed</td><td><code>{String(service.schemaVersion ?? 'unknown')}</code></td></tr>
          <tr><td>schema observed</td><td><code>{observed ?? 'unknown'}</code></td></tr>
          <tr><td>registry</td><td><code>{String(service.registryVersion ?? 'unknown')}</code></td></tr>
        </tbody>
      </table>
    </div>
  );
}

function MemoryCard({ card }: { card: StatusCard }) {
  const counts = (card.data.nodesByTruthStatus ?? {}) as Record<string, number>;
  const newest = card.data.newestCardAt as string | null;
  const quarantined = Number(card.data.quarantined ?? 0);

  return (
    <div className={styles.card} data-testid="card-memory">
      <h3>{card.title}</h3>
      <div className={styles.bigNumbers}>
        <div><span className={styles.big}>{Number(card.data.cards ?? 0)}</span><span className={styles.label}>cards</span></div>
        <div><span className={styles.big}>{quarantined}</span><span className={styles.label}>quarantined</span></div>
      </div>
      <p className={styles.when}>
        newest card: {newest ? new Date(newest).toLocaleString() : 'none ingested'}
      </p>
      {quarantined > 0 && (
        <p className={styles.error}>{quarantined} card(s) held for review — source-free.</p>
      )}
      {Object.keys(counts).length > 0 && (
        <table className={styles.table}>
          <tbody>
            {Object.entries(counts).map(([status, n]) => (
              <tr key={status}><td>{status}</td><td>{n}</td></tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function MissionControlLive() {
  const apiUrl = ((import.meta.env.VITE_API_URL as string | undefined) || 'http://localhost:3000').replace(/\/$/, '');
  const { session, signIn, signOut } = useOperatorSession();
  const [spaces, setSpaces] = useState<SpaceOption[]>([]);
  const [spaceId, setSpaceIdState] = useState<string | null>(() => readStoredSpace(localStorage));
  const [spaceError, setSpaceError] = useState<string | null>(null);
  // Optional agent-scoped override, used to reproduce what a scoped API token
  // can do. Deliberately not persisted: it is a diagnostic, not a session.
  const [overrideToken, setOverrideToken] = useState('');

  const setSpaceId = useCallback((next: string | null) => {
    writeStoredSpace(localStorage, next);
    setSpaceIdState(next);
  }, []);

  // The Space is sent as x-atlas-space; without it the API refuses every
  // approval-gated capability (apps/api/src/pipeline.ts).
  const client = useMemo(
    () =>
      createGeneratedClient({
        baseUrl: apiUrl,
        token: overrideToken.trim() || session.accessToken || undefined,
        spaceId: spaceId ?? undefined,
      }),
    [apiUrl, session.accessToken, spaceId, overrideToken],
  );
  const [payload, setPayload] = useState<MissionControlPayload | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    if (session.status !== 'signed_in') return;
    const supabase = getSupabase();
    if (!supabase) return;
    let active = true;
    void listSpaces(supabase)
      .then((options) => {
        if (!active) return;
        setSpaces(options);
        setSpaceError(null);
        // Only auto-select when the choice is unambiguous; silently picking
        // among several would change what every governed action applies to.
        if (!spaceId && options.length === 1) setSpaceId(options[0].spaceId);
      })
      .catch((err: unknown) => {
        if (active) setSpaceError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      active = false;
    };
  }, [session.status, spaceId, setSpaceId]);

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
    if (session.status !== 'signed_in') return;
    void refresh();
    const t = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(t);
  }, [refresh, session.status]);

  if (session.status === 'loading') {
    return <p className={styles.when}>Restoring session…</p>;
  }

  if (session.status !== 'signed_in') {
    return (
      <SignIn
        onSubmit={signIn}
        status={session.status}
        error={session.error}
      />
    );
  }

  return (
    <div>
      <div className={styles.toolbar}>
        <span className={styles.when} data-testid="operator-email">
          {session.email}
        </span>
        <label className={styles.field}>
          <span>Space</span>
          <select
            data-testid="space-select"
            value={spaceId ?? ''}
            onChange={(e) => setSpaceId(e.target.value || null)}
          >
            <option value="">— select a Space —</option>
            {spaces.map((s) => (
              <option key={s.spaceId} value={s.spaceId}>
                {s.name} ({s.slug})
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => void signOut()}>
          Sign out
        </button>
        {payload && <span className={styles.when}>updated {new Date(payload.generatedAt).toLocaleTimeString()}</span>}
      </div>
      {!spaceId && (
        <p className={styles.error} role="alert">
          Select a Space before approving or sending. Governed actions require one.
        </p>
      )}
      <details className={styles.advanced}>
        <summary>Advanced: act as a scoped API token</summary>
        <p className={styles.when}>
          Overrides the operator session for every call below, so you can observe
          exactly what an agent-scoped credential is allowed to do. Not saved.
        </p>
        <input
          className={styles.tokenInput}
          type="password"
          data-testid="override-token"
          placeholder="api token (diagnostic only)"
          value={overrideToken}
          onChange={(e) => setOverrideToken(e.target.value)}
        />
        {overrideToken.trim() !== '' && (
          <p className={styles.error} role="alert">
            Acting as a scoped API token, not as the operator.
          </p>
        )}
      </details>
      {spaceError && <p className={styles.error}>space lookup failed: {spaceError}</p>}
      {fetchError && <p className={styles.error}>status fetch failed: {fetchError}</p>}
      <div className={styles.cardGrid}>
        {(payload?.cards ?? []).map((card) => {
          switch (card.kind) {
            case 'approvals':
              return (
                <ApprovalsCard
                  key={card.id}
                  card={card}
                  client={client}
                  onDecided={() => void refresh()}
                  hasSpace={spaceId !== null}
                />
              );
            case 'runs':
              return <RunsCard key={card.id} card={card} />;
            case 'model_chain':
              return <ModelChainCard key={card.id} card={card} />;
            case 'cache':
              return <CacheCard key={card.id} card={card} />;
            case 'schedules':
              return <SchedulesCard key={card.id} card={card} />;
            case 'memory':
              return <MemoryCard key={card.id} card={card} />;
            case 'deployment':
              return <DeploymentCard key={card.id} card={card} />;
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
