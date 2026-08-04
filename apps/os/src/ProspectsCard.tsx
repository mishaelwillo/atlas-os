/**
 * Prospects and the demo queue (docs/specs/p2/revenue-pilot.md).
 *
 * Rendered from the declarative `status.mission_control` payload; it calls
 * capabilities only to *act* — qualify, enqueue, advance — never to read what
 * it displays.
 *
 * Two distinctions this component exists to keep:
 *
 * 1. **Unknown is not false.** Every rubric field that can be unanswered is a
 *    three-way control, and an unanswered one is simply not sent. The rubric
 *    treats a settled `false` as a blocker that disqualifies and an unanswered
 *    field as a question that sends the prospect to review; a checkbox would
 *    collapse the two and quietly disqualify prospects nobody had checked.
 *
 * 2. **A refusal is not a success.** `demos.enqueue` and `demos.advance` answer
 *    200 with `enqueued: false` / `advanced: false` and a reason. Reporting
 *    only the absence of an exception would show an operator a queued demo
 *    that was never queued.
 */
import React, { useCallback, useState } from 'react';
import type { AtlasGeneratedClient } from '@atlas/client';
import styles from './MissionControl.module.css';

export interface ProspectQualification {
  verdict: string;
  total: number;
  assessedAt: string;
  expiresAt: string;
  expired: boolean;
}

export interface ProspectDemo {
  queueId: string;
  state: string;
  siteId: string | null;
  expiresAt: string;
  moves: string[];
}

export interface ProspectItem {
  leadId: string;
  businessName: string;
  leadStatus: string;
  qualification: ProspectQualification | null;
  demo: ProspectDemo | null;
}

export interface ProspectsData {
  available?: boolean;
  note?: string;
  queue?: {
    active: number;
    cap: number;
    floor: number;
    remaining: number;
    belowFloor: boolean;
  } | null;
  rubric?: {
    dimensions: string[];
    maxScore: number;
    qualifyingScore: number;
    maxDemoEffortHours: number;
  };
  demoStates?: string[];
  items?: ProspectItem[];
}

/** Unanswered, or answered either way. Absent is a real third value. */
type Tri = 'unknown' | 'yes' | 'no';

interface EvidenceForm {
  region: string;
  vertical: string;
  targetRegions: string;
  targetVerticals: string;
  activeProfile: Tri;
  websiteUrl: string;
  weakSiteProblem: string;
  identityVerified: Tri;
  locationVerified: Tri;
  publicFactCount: string;
  contactSource: string;
  contactPolicyReviewed: Tri;
  duplicateOf: string;
  operatingStatus: 'open' | 'closed' | 'uncertain';
  demoEffortHours: string;
  deceptiveDemoRisk: boolean;
  benefitRationale: string;
}

const BLANK_EVIDENCE: EvidenceForm = {
  region: '',
  vertical: '',
  targetRegions: '',
  targetVerticals: '',
  activeProfile: 'unknown',
  websiteUrl: '',
  weakSiteProblem: '',
  identityVerified: 'unknown',
  locationVerified: 'unknown',
  publicFactCount: '0',
  contactSource: '',
  contactPolicyReviewed: 'unknown',
  duplicateOf: '',
  // The rubric's own default for an unestablished business, named rather than
  // implied: it is an unknown that sends the prospect to review.
  operatingStatus: 'uncertain',
  demoEffortHours: '0',
  deceptiveDemoRisk: false,
  benefitRationale: '',
};

function list(value: string): string[] {
  return value
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v !== '');
}

function num(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Build the evidence object sent to `prospecting.qualify`.
 *
 * An unanswered three-way field is omitted entirely rather than sent as false.
 * The API reads a missing boolean as unknown, so omission is how "nobody has
 * checked" survives the wire.
 */
export function buildEvidence(form: EvidenceForm): Record<string, unknown> {
  const evidence: Record<string, unknown> = {
    region: form.region.trim(),
    vertical: form.vertical.trim(),
    targetRegions: list(form.targetRegions),
    targetVerticals: list(form.targetVerticals),
    publicFactCount: num(form.publicFactCount),
    operatingStatus: form.operatingStatus,
    demoEffortHours: num(form.demoEffortHours),
    deceptiveDemoRisk: form.deceptiveDemoRisk,
  };
  const tri: Array<[keyof EvidenceForm, string]> = [
    ['activeProfile', 'activeProfile'],
    ['identityVerified', 'identityVerified'],
    ['locationVerified', 'locationVerified'],
    ['contactPolicyReviewed', 'contactPolicyReviewed'],
  ];
  for (const [key, field] of tri) {
    const value = form[key] as Tri;
    if (value !== 'unknown') evidence[field] = value === 'yes';
  }
  const optional: Array<[keyof EvidenceForm, string]> = [
    ['websiteUrl', 'websiteUrl'],
    ['weakSiteProblem', 'weakSiteProblem'],
    ['contactSource', 'contactSource'],
    ['duplicateOf', 'duplicateOf'],
    ['benefitRationale', 'benefitRationale'],
  ];
  for (const [key, field] of optional) {
    const value = String(form[key]).trim();
    if (value !== '') evidence[field] = value;
  }
  return evidence;
}

/** What the API actually did, including the refusals it reports with a 200. */
export function describeOutcome(result: Record<string, unknown>): string {
  if (result.status === 'schema_pending') {
    return `Nothing was recorded — ${String(result.note ?? 'the schema is behind the code')}.`;
  }
  if (result.enqueued === false || result.advanced === false) {
    return `Refused (${String(result.code ?? 'no code')}) — ${String(result.note ?? 'no reason given')}`;
  }
  if (typeof result.verdict === 'string') {
    const total = typeof result.total === 'number' ? ` · scored ${result.total}` : '';
    const stored = typeof result.assessmentId === 'string' ? '' : ' · not stored';
    return `${result.verdict}${total}${stored}`;
  }
  if (result.enqueued === true) {
    const remaining = typeof result.remaining === 'number' ? ` · ${result.remaining} slots left` : '';
    const thin = result.belowFloor === true ? ' · queue still under the pilot floor' : '';
    return `Queued${remaining}${thin}`;
  }
  if (result.advanced === true) {
    return `Moved ${String(result.from)} → ${String(result.to)}`;
  }
  return `status ${String(result.status ?? 'unknown')}`;
}

function TriField({
  label,
  value,
  onChange,
  testId,
}: {
  label: string;
  value: Tri;
  onChange: (next: Tri) => void;
  testId: string;
}): React.ReactElement {
  return (
    <label className={styles.field}>
      <span>{label}</span>
      <select
        data-testid={testId}
        value={value}
        onChange={(e) => onChange(e.target.value as Tri)}
      >
        <option value="unknown">not checked</option>
        <option value="yes">yes</option>
        <option value="no">no</option>
      </select>
    </label>
  );
}

export interface ProspectsCardProps {
  data: ProspectsData;
  client: AtlasGeneratedClient;
  hasSpace: boolean;
  onChanged: () => void;
}

export function ProspectsCard({
  data,
  client,
  hasSpace,
  onChanged,
}: ProspectsCardProps): React.ReactElement {
  const [openLead, setOpenLead] = useState<string | null>(null);
  const [form, setForm] = useState<EvidenceForm>({ ...BLANK_EVIDENCE });
  const [move, setMove] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);

  const items = data.items ?? [];
  const queue = data.queue ?? null;
  const rubric = data.rubric ?? null;

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
        setOutcome(describeOutcome(res));
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
      <div className={styles.card} data-testid="card-prospects">
        <h3>Prospects and demo queue</h3>
        <p className={styles.error} role="status">
          {data.note ?? 'The pilot pipeline cannot be read.'}
        </p>
      </div>
    );
  }

  const update = (patch: Partial<EvidenceForm>) => setForm((f) => ({ ...f, ...patch }));

  return (
    <div className={styles.card} data-testid="card-prospects">
      <h3>
        Prospects and demo queue <span className={styles.count}>{items.length}</span>
      </h3>

      {queue && (
        <p className={styles.when} data-testid="queue-summary">
          {queue.active} of {queue.cap} demo slots in use · {queue.remaining} free
          {/* Thin is advisory: the pilot wants 5–10, and fewer is not a fault. */}
          {queue.belowFloor && ` · under the ${queue.floor}-slot pilot floor (advisory)`}
        </p>
      )}

      {items.length === 0 && (
        <p className={styles.empty}>
          No prospects yet. Lead sourcing has no directory adapter, so this is empty by
          construction rather than by outcome.
        </p>
      )}

      <table className={styles.table}>
        <tbody>
          {items.map((p) => (
            <tr key={p.leadId} data-testid={`prospect-${p.leadId}`}>
              <td>{p.businessName}</td>
              <td>{p.leadStatus}</td>
              <td>
                {/* Never assessed is not a verdict, and shows as an em dash. */}
                {p.qualification === null ? (
                  <span className={styles.when}>—</span>
                ) : (
                  <>
                    {p.qualification.verdict} ({p.qualification.total}/{rubric?.maxScore ?? 30})
                    {p.qualification.expired && (
                      <span className={styles.error}> stale</span>
                    )}
                  </>
                )}
              </td>
              <td>{p.demo === null ? <span className={styles.when}>—</span> : p.demo.state}</td>
              <td>
                <button
                  type="button"
                  data-testid={`assess-${p.leadId}`}
                  onClick={() => {
                    setOpenLead(openLead === p.leadId ? null : p.leadId);
                    setForm({ ...BLANK_EVIDENCE });
                  }}
                >
                  {openLead === p.leadId ? 'Close' : 'Assess'}
                </button>
                {p.demo === null ? (
                  <button
                    type="button"
                    data-testid={`enqueue-${p.leadId}`}
                    disabled={busy}
                    onClick={() => void act(() => client.demosEnqueue({ leadId: p.leadId }))}
                  >
                    Queue demo
                  </button>
                ) : p.demo.moves.length === 0 ? (
                  <span className={styles.when} data-testid={`no-moves-${p.leadId}`}>
                    no further move
                  </span>
                ) : (
                  <>
                    <select
                      data-testid={`demo-move-${p.leadId}`}
                      value={move[p.demo.queueId] ?? ''}
                      onChange={(e) =>
                        setMove((m) => ({ ...m, [p.demo?.queueId ?? '']: e.target.value }))
                      }
                    >
                      <option value="">— move to —</option>
                      {p.demo.moves.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      data-testid={`advance-${p.leadId}`}
                      disabled={busy || !move[p.demo.queueId]}
                      onClick={() => {
                        const queueId = p.demo?.queueId ?? '';
                        void act(() =>
                          client.demosAdvance({ queueId, state: move[queueId] ?? '' }),
                        );
                      }}
                    >
                      Move
                    </button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {openLead !== null && (
        <div className={styles.factRow} data-testid="qualify-form">
          <p className={styles.when}>
            The verdict is derived from this evidence, not chosen. A field left “not
            checked” is an open question that sends the prospect to review; answering it
            “no” can be a settled fact that disqualifies.
            {rubric &&
              ` Qualifying needs ${rubric.qualifyingScore}/${rubric.maxScore} and no blockers.`}
          </p>

          <label className={styles.field}>
            <span>Region</span>
            <input
              data-testid="ev-region"
              value={form.region}
              onChange={(e) => update({ region: e.target.value })}
            />
          </label>
          <label className={styles.field}>
            <span>Vertical</span>
            <input
              data-testid="ev-vertical"
              value={form.vertical}
              onChange={(e) => update({ vertical: e.target.value })}
            />
          </label>
          <label className={styles.field}>
            <span>Cohort regions (comma separated)</span>
            <input
              data-testid="ev-target-regions"
              value={form.targetRegions}
              onChange={(e) => update({ targetRegions: e.target.value })}
            />
          </label>
          <label className={styles.field}>
            <span>Cohort verticals (comma separated)</span>
            <input
              data-testid="ev-target-verticals"
              value={form.targetVerticals}
              onChange={(e) => update({ targetVerticals: e.target.value })}
            />
          </label>

          <TriField
            label="Directory profile is active"
            testId="ev-active-profile"
            value={form.activeProfile}
            onChange={(v) => update({ activeProfile: v })}
          />
          <TriField
            label="Identity verified"
            testId="ev-identity"
            value={form.identityVerified}
            onChange={(v) => update({ identityVerified: v })}
          />
          <TriField
            label="Location verified"
            testId="ev-location"
            value={form.locationVerified}
            onChange={(v) => update({ locationVerified: v })}
          />
          <TriField
            label="Contact policy and provider terms reviewed"
            testId="ev-policy"
            value={form.contactPolicyReviewed}
            onChange={(v) => update({ contactPolicyReviewed: v })}
          />

          <label className={styles.field}>
            <span>Existing website (blank if none found)</span>
            <input
              data-testid="ev-website"
              value={form.websiteUrl}
              onChange={(e) => update({ websiteUrl: e.target.value })}
            />
          </label>
          <label className={styles.field}>
            <span>Documented weak-site problem — required if a site exists</span>
            <input
              data-testid="ev-weak-site"
              value={form.weakSiteProblem}
              onChange={(e) => update({ weakSiteProblem: e.target.value })}
            />
          </label>
          <label className={styles.field}>
            <span>Sourced public facts</span>
            <input
              data-testid="ev-facts"
              type="number"
              value={form.publicFactCount}
              onChange={(e) => update({ publicFactCount: e.target.value })}
            />
          </label>
          <label className={styles.field}>
            <span>Where the contact detail came from</span>
            <input
              data-testid="ev-contact-source"
              value={form.contactSource}
              onChange={(e) => update({ contactSource: e.target.value })}
            />
          </label>
          <label className={styles.field}>
            <span>Duplicate of (blank if not a duplicate)</span>
            <input
              data-testid="ev-duplicate"
              value={form.duplicateOf}
              onChange={(e) => update({ duplicateOf: e.target.value })}
            />
          </label>
          <label className={styles.field}>
            <span>Operating status</span>
            <select
              data-testid="ev-operating"
              value={form.operatingStatus}
              onChange={(e) =>
                update({ operatingStatus: e.target.value as EvidenceForm['operatingStatus'] })
              }
            >
              <option value="uncertain">not established</option>
              <option value="open">trading</option>
              <option value="closed">closed</option>
            </select>
          </label>
          <label className={styles.field}>
            <span>
              Estimated demo effort, hours
              {rubric ? ` (cap ${rubric.maxDemoEffortHours})` : ''}
            </span>
            <input
              data-testid="ev-effort"
              type="number"
              value={form.demoEffortHours}
              onChange={(e) => update({ demoEffortHours: e.target.value })}
            />
          </label>
          <label className={styles.checkLine}>
            <input
              type="checkbox"
              data-testid="ev-deceptive"
              checked={form.deceptiveDemoRisk}
              onChange={(e) => update({ deceptiveDemoRisk: e.target.checked })}
            />
            <span>A demo would misrepresent this business</span>
          </label>
          <label className={styles.field}>
            <span>Why they would plausibly benefit</span>
            <input
              data-testid="ev-benefit"
              value={form.benefitRationale}
              onChange={(e) => update({ benefitRationale: e.target.value })}
            />
          </label>

          <div className={styles.buttonRow}>
            <button
              type="button"
              data-testid="submit-qualify"
              disabled={busy}
              onClick={() =>
                void act(() =>
                  client.prospectingQualify({
                    leadId: openLead,
                    evidence: buildEvidence(form),
                  }),
                )
              }
            >
              {busy ? 'Assessing…' : 'Record assessment'}
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {outcome && (
        <p className={styles.when} data-testid="prospect-outcome" role="status">
          {outcome}
        </p>
      )}
    </div>
  );
}
