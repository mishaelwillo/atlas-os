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
import React, { useCallback, useRef, useState } from 'react';
import type { AtlasGeneratedClient } from '@atlas/client';
import styles from './MissionControl.module.css';

export interface ProspectQualification {
  verdict: string;
  total: number;
  assessedAt: string;
  expiresAt: string;
  expired: boolean;
  /**
   * The evidence behind this verdict, so re-assessing edits it rather than
   * replacing it with whatever a blank form happened to contain. Null when the
   * row carries none the API could read.
   */
  evidence?: Record<string, unknown> | null;
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

/** A prospect an operator sourced by hand, before a directory adapter exists. */
interface LeadForm {
  businessName: string;
  sourceUrl: string;
  phone: string;
  websiteUrl: string;
}

const BLANK_LEAD: LeadForm = { businessName: '', sourceUrl: '', phone: '', websiteUrl: '' };

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

/**
 * Load a stored evidence object back into the form.
 *
 * The inverse of `buildEvidence`, and the reason re-assessing is now an edit
 * rather than a create. The form used to reset to blank on every open, so an
 * operator correcting one field silently dropped every other and the rubric
 * faithfully scored the emptier evidence — twice in one session, once nearly
 * losing the documented weak-site problem that was the only thing keeping a
 * prospect out of a blocker.
 *
 * A missing boolean loads as `unknown`, not `no`. The rubric treats those
 * differently — an unknown sends a prospect to review, a settled false can
 * disqualify — so collapsing them here would put a verdict on the record that
 * nobody decided.
 */
export function loadEvidence(stored: Record<string, unknown>): EvidenceForm {
  const text = (key: string): string => {
    const value = stored[key];
    return typeof value === 'string' ? value : '';
  };
  const tri = (key: string): Tri => {
    const value = stored[key];
    if (value === true) return 'yes';
    if (value === false) return 'no';
    return 'unknown';
  };
  const csv = (key: string): string => {
    const value = stored[key];
    return Array.isArray(value) ? value.map((v) => String(v)).join(', ') : '';
  };
  const count = (key: string, fallback: string): string => {
    const value = stored[key];
    return typeof value === 'number' && Number.isFinite(value) ? String(value) : fallback;
  };
  const status = stored.operatingStatus;
  return {
    region: text('region'),
    vertical: text('vertical'),
    targetRegions: csv('targetRegions'),
    targetVerticals: csv('targetVerticals'),
    activeProfile: tri('activeProfile'),
    websiteUrl: text('websiteUrl'),
    weakSiteProblem: text('weakSiteProblem'),
    identityVerified: tri('identityVerified'),
    locationVerified: tri('locationVerified'),
    publicFactCount: count('publicFactCount', BLANK_EVIDENCE.publicFactCount),
    contactSource: text('contactSource'),
    contactPolicyReviewed: tri('contactPolicyReviewed'),
    duplicateOf: text('duplicateOf'),
    operatingStatus:
      status === 'open' || status === 'closed' || status === 'uncertain'
        ? status
        : BLANK_EVIDENCE.operatingStatus,
    demoEffortHours: count('demoEffortHours', BLANK_EVIDENCE.demoEffortHours),
    deceptiveDemoRisk: stored.deceptiveDemoRisk === true,
    benefitRationale: text('benefitRationale'),
  };
}

/** What the API actually did, including the refusals it reports with a 200. */
export function describeOutcome(result: Record<string, unknown>): string {
  if (result.status === 'schema_pending') {
    return `Nothing was recorded — ${String(result.note ?? 'the schema is behind the code')}.`;
  }
  if (result.enqueued === false || result.advanced === false || result.recorded === false) {
    const duplicate =
      typeof result.duplicateOf === 'string' ? ` · already recorded as ${result.duplicateOf.slice(0, 8)}` : '';
    return `Refused (${String(result.code ?? 'no code')}) — ${String(
      result.note ?? 'no reason given',
    )}${duplicate}`;
  }
  if (result.recorded === true) {
    return `Recorded as ${String(result.leadId).slice(0, 8)} — qualify it next.`;
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
  const [lead, setLead] = useState<LeadForm>({ ...BLANK_LEAD });
  const [move, setMove] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);

  const items = data.items ?? [];
  const queue = data.queue ?? null;
  const rubric = data.rubric ?? null;

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
        setOutcome(describeOutcome(res));
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
          No prospects yet. Automatic lead sourcing has no directory adapter, so record one
          by hand below — that is the pilot workflow until it does.
        </p>
      )}

      {/*
        Recording a prospect by hand. `leads.find` needs an approved directory
        adapter and has none, so without this there is no way to get a prospect
        into the pilot at all: every surface here keys off a lead.

        The source is required because the rubric's contact-source check is one
        an unsourced prospect can never pass, so admitting one would only
        create a lead that cannot be qualified.
      */}
      <details className={styles.factRow} data-testid="record-lead">
        <summary>Record a prospect you sourced by hand</summary>
        <label className={styles.field}>
          <span>Business name</span>
          <input
            data-testid="lead-business-name"
            value={lead.businessName}
            onChange={(e) => setLead((l) => ({ ...l, businessName: e.target.value }))}
          />
        </label>
        <label className={styles.field}>
          <span>Where you found them — required</span>
          <input
            data-testid="lead-source-url"
            placeholder="https://maps.google.com/?cid=..."
            value={lead.sourceUrl}
            onChange={(e) => setLead((l) => ({ ...l, sourceUrl: e.target.value }))}
          />
        </label>
        <label className={styles.field}>
          <span>Phone</span>
          <input
            data-testid="lead-phone"
            value={lead.phone}
            onChange={(e) => setLead((l) => ({ ...l, phone: e.target.value }))}
          />
        </label>
        <label className={styles.field}>
          <span>Existing website, if they have one</span>
          <input
            data-testid="lead-website"
            value={lead.websiteUrl}
            onChange={(e) => setLead((l) => ({ ...l, websiteUrl: e.target.value }))}
          />
        </label>
        <button
          type="button"
          data-testid="submit-lead"
          disabled={busy}
          onClick={() => {
            if (lead.businessName.trim() === '' || lead.sourceUrl.trim() === '') {
              setError('A business name and where you found them are both required.');
              return;
            }
            void act(() =>
              client.leadsRecord({
                businessName: lead.businessName.trim(),
                sourceUrl: lead.sourceUrl.trim(),
                ...(lead.phone.trim() === '' ? {} : { phone: lead.phone.trim() }),
                ...(lead.websiteUrl.trim() === '' ? {} : { websiteUrl: lead.websiteUrl.trim() }),
              }),
            ).then(() => setLead({ ...BLANK_LEAD }));
          }}
        >
          {busy ? 'Recording…' : 'Record prospect'}
        </button>
      </details>

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
                    const opening = openLead !== p.leadId;
                    setOpenLead(opening ? p.leadId : null);
                    /*
                     * Start from what was recorded, not from blank. Blank only
                     * when there is nothing to start from — a first assessment,
                     * or a standing one whose evidence could not be read, which
                     * the form says out loud rather than silently showing an
                     * empty set that looks identical to a lost one.
                     */
                    const stored = opening ? (p.qualification?.evidence ?? null) : null;
                    setForm(stored === null ? { ...BLANK_EVIDENCE } : loadEvidence(stored));
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
          {/*
            Which of the three states this form is in, said out loud. A blank
            first assessment and a standing one whose evidence was lost look
            identical once the fields are empty, and the second is the one that
            quietly replaces a good record with a worse one.
          */}
          {(() => {
            const standing = items.find((p) => p.leadId === openLead)?.qualification ?? null;
            if (standing === null) {
              return (
                <p className={styles.when} data-testid="assess-mode">
                  First assessment for this prospect.
                </p>
              );
            }
            if (standing.evidence === null || standing.evidence === undefined) {
              return (
                <p className={styles.error} data-testid="assess-mode">
                  Editing the assessment recorded{' '}
                  {new Date(standing.assessedAt).toLocaleDateString()} — but its evidence
                  could not be read, so these fields start empty. Submitting will replace
                  the recorded evidence with whatever is entered here.
                </p>
              );
            }
            return (
              <p className={styles.when} data-testid="assess-mode">
                Editing the assessment recorded{' '}
                {new Date(standing.assessedAt).toLocaleDateString()} ({standing.verdict},{' '}
                {standing.total}). Fields start from what was recorded; changing one keeps
                the rest.
              </p>
            );
          })()}
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
