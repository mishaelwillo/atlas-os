/**
 * Prospect qualification (docs/specs/p2/revenue-pilot.md).
 *
 * The prospect state machine is
 * `sourced → eligibility_review → qualified|disqualified|expired`, and the
 * specification's rubric decides which. The acceptance is that every qualified
 * prospect carries "active-profile evidence, no/weak-site assessment, source
 * provenance, contact-policy decision, region, owner, and expiry" — so this
 * refuses to qualify anything missing one of those, rather than scoring around
 * the gap.
 *
 * Two kinds of failure are kept apart. A *blocker* is a settled fact that
 * disqualifies — a duplicate, a closed business, a demo that would misrepresent
 * the prospect. An *unknown* is something nobody has established yet, and the
 * specification is explicit that "provider/eligibility uncertainty sends to
 * review". Collapsing the two would either discard prospects that only need a
 * question answered, or quietly approve outreach on an unanswered one.
 *
 * Pure and deterministic — no clock, no database — so the same evidence always
 * produces the same verdict, and the assessment stored against a prospect can
 * be re-derived from what was recorded.
 */

/** How long an assessment stands before the sourced facts must be re-checked. */
export const QUALIFICATION_TTL_DAYS = 30;

/** Demo effort beyond this is outside the pilot's per-prospect budget. */
export const MAX_DEMO_EFFORT_HOURS = 4;

/** The six dimensions the specification names, each scored 0–5. */
export const SCORE_DIMENSIONS = [
  'fit',
  'urgency',
  'evidence',
  'contactability',
  'demoEffort',
  'risk',
] as const;

export type ScoreDimension = (typeof SCORE_DIMENSIONS)[number];

export const MAX_SCORE = SCORE_DIMENSIONS.length * 5;

/**
 * Total at or above which a prospect with no blockers is worth the effort.
 *
 * The required checks are strict enough that a prospect which clears all of
 * them cannot score below 22: it is in the cohort, its profile is active, its
 * identity and location are verified, its contact source and policy are
 * settled, and it is trading. So the threshold only means anything inside
 * 22–30, and 24 is where it sits — it separates a marginal prospect (an
 * existing site with a minor problem, barely enough facts, a day's work) from
 * one worth a slot, and sends the marginal one to a human rather than
 * discarding it.
 */
export const QUALIFYING_SCORE = 24;

export interface QualificationEvidence {
  /** Region and vertical this prospect was sourced for. */
  region: string;
  vertical: string;
  /** The cohort the pilot is currently running; one at a time by design. */
  targetRegions: readonly string[];
  targetVerticals: readonly string[];
  /** Whether the directory profile is currently active. */
  activeProfile: boolean | null;
  /** Existing site, if any. Null means none was found. */
  websiteUrl: string | null;
  /** Documented problem with an existing site; required when one exists. */
  weakSiteProblem: string | null;
  identityVerified: boolean | null;
  locationVerified: boolean | null;
  /** Sourced public facts available to build a demo from. */
  publicFactCount: number;
  /** Where the contact detail came from; provenance is required. */
  contactSource: string | null;
  /** Whether provider terms and contact policy have been reviewed. */
  contactPolicyReviewed: boolean | null;
  /** Suppression is checked against the lead, never assumed. */
  suppressed: boolean;
  /** Set when this prospect duplicates one already in the pilot. */
  duplicateOf: string | null;
  operatingStatus: 'open' | 'closed' | 'uncertain';
  /** Estimated hours to produce an approvable demo. */
  demoEffortHours: number;
  /** True when a demo would misrepresent the business. */
  deceptiveDemoRisk: boolean;
  /** Why this prospect would plausibly benefit; required, in the operator's words. */
  benefitRationale: string | null;
}

export type QualificationVerdict = 'qualified' | 'disqualified' | 'eligibility_review';

export interface QualificationFinding {
  code: string;
  detail: string;
}

export interface QualificationResult {
  verdict: QualificationVerdict;
  /** 0–30 across the six dimensions; advisory when a blocker exists. */
  total: number;
  scores: Record<ScoreDimension, number>;
  /** Settled facts that disqualify. */
  blockers: QualificationFinding[];
  /** Things nobody has established yet; these send the prospect to review. */
  unknowns: QualificationFinding[];
  /** When this assessment stops standing, as an ISO timestamp. */
  expiresAt: string;
}

function finding(code: string, detail: string): QualificationFinding {
  return { code, detail };
}

/** Clamp a raw judgement into the 0–5 band every dimension shares. */
function band(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(5, Math.round(value)));
}

/**
 * Score the six dimensions from the evidence.
 *
 * Scores are derived, not supplied, so two operators assessing the same
 * evidence cannot reach different totals. Where evidence is absent the
 * dimension scores zero rather than defaulting to the middle — an unknown is
 * not an average.
 */
function score(evidence: QualificationEvidence): Record<ScoreDimension, number> {
  const inRegion = evidence.targetRegions.includes(evidence.region);
  const inVertical = evidence.targetVerticals.includes(evidence.vertical);
  const hasSite = evidence.websiteUrl !== null && evidence.websiteUrl.trim() !== '';

  return {
    // Squarely in the cohort, or only half of it.
    fit: band((inRegion ? 3 : 0) + (inVertical ? 2 : 0)),
    /*
     * No site at all is the pilot's strongest signal; a documented weak-site
     * problem is a weaker but real one. A site with no documented problem
     * scores nothing — "they could do better" is not a finding.
     */
    urgency: band(!hasSite ? 5 : evidence.weakSiteProblem !== null ? 3 : 0),
    // Enough sourced facts to build a page without inventing any.
    evidence: band(
      (evidence.activeProfile === true ? 2 : 0) +
        (evidence.identityVerified === true ? 1 : 0) +
        (evidence.locationVerified === true ? 1 : 0) +
        (evidence.publicFactCount >= 4 ? 1 : 0),
    ),
    // A reachable contact whose provenance and policy are settled.
    contactability: band(
      (evidence.contactSource !== null && evidence.contactSource.trim() !== '' ? 3 : 0) +
        (evidence.contactPolicyReviewed === true ? 2 : 0),
    ),
    // Cheaper demos score higher; at the cap it scores nothing.
    demoEffort: band(5 - (evidence.demoEffortHours / MAX_DEMO_EFFORT_HOURS) * 5),
    // Risk is scored as its absence, so every dimension points the same way.
    risk: band(
      (evidence.deceptiveDemoRisk ? 0 : 3) + (evidence.operatingStatus === 'open' ? 2 : 0),
    ),
  };
}

/** Settled facts that disqualify a prospect outright. */
function blockersFor(evidence: QualificationEvidence): QualificationFinding[] {
  const found: QualificationFinding[] = [];
  const hasSite = evidence.websiteUrl !== null && evidence.websiteUrl.trim() !== '';

  if (evidence.duplicateOf !== null) {
    found.push(finding('duplicate', `already in the pilot as ${evidence.duplicateOf}`));
  }
  if (evidence.operatingStatus === 'closed') {
    found.push(finding('closed', 'the business is recorded as closed'));
  }
  if (evidence.suppressed) {
    found.push(finding('suppressed', 'the lead is suppressed; no outreach is permitted'));
  }
  if (evidence.deceptiveDemoRisk) {
    found.push(finding('deceptive_demo_risk', 'a demo would misrepresent this business'));
  }
  if (evidence.activeProfile === false) {
    found.push(finding('inactive_profile', 'the directory profile is not active'));
  }
  if (!evidence.targetRegions.includes(evidence.region)) {
    found.push(
      finding('outside_cohort_region', `region '${evidence.region}' is not in the pilot cohort`),
    );
  }
  if (!evidence.targetVerticals.includes(evidence.vertical)) {
    found.push(
      finding('outside_cohort_vertical', `vertical '${evidence.vertical}' is not in the pilot cohort`),
    );
  }
  if (hasSite && evidence.weakSiteProblem === null) {
    // "They could do better" is not a finding. Without a documented problem
    // there is nothing to show the owner that they do not already have.
    found.push(
      finding('site_without_documented_problem', 'an existing site with no documented weak-site problem'),
    );
  }
  if (evidence.demoEffortHours > MAX_DEMO_EFFORT_HOURS) {
    found.push(
      finding(
        'demo_effort_over_cap',
        `${evidence.demoEffortHours}h exceeds the ${MAX_DEMO_EFFORT_HOURS}h per-prospect cap`,
      ),
    );
  }
  return found;
}

/** Questions nobody has answered yet. These send the prospect to review. */
function unknownsFor(evidence: QualificationEvidence): QualificationFinding[] {
  const found: QualificationFinding[] = [];

  if (evidence.activeProfile === null) {
    found.push(finding('profile_activity_unknown', 'nobody has checked whether the profile is active'));
  }
  if (evidence.operatingStatus === 'uncertain') {
    found.push(finding('operating_status_uncertain', 'it is not established that the business is trading'));
  }
  if (evidence.identityVerified !== true || evidence.locationVerified !== true) {
    found.push(finding('identity_unverified', 'identity and location are not both verified'));
  }
  if (evidence.contactSource === null || evidence.contactSource.trim() === '') {
    found.push(finding('contact_provenance_missing', 'the contact detail has no recorded source'));
  }
  if (evidence.contactPolicyReviewed !== true) {
    // The specification blocks on unresolved policy rather than proceeding.
    found.push(finding('contact_policy_unreviewed', 'provider terms and contact policy are not reviewed'));
  }
  if (evidence.publicFactCount < 3) {
    found.push(
      finding('insufficient_facts', `${evidence.publicFactCount} sourced facts is too few to build from`),
    );
  }
  if (evidence.benefitRationale === null || evidence.benefitRationale.trim() === '') {
    found.push(finding('benefit_unstated', 'no stated reason this prospect would benefit'));
  }
  return found;
}

/**
 * Assess one prospect against the rubric.
 *
 * `assessedAt` is passed in rather than read from the clock so the result is a
 * pure function of its inputs, and so a stored assessment can be recomputed
 * from what was recorded to check it still says the same thing.
 */
export function assessProspect(
  evidence: QualificationEvidence,
  assessedAt: Date,
  ttlDays = QUALIFICATION_TTL_DAYS,
): QualificationResult {
  const scores = score(evidence);
  const total = SCORE_DIMENSIONS.reduce((sum, d) => sum + scores[d], 0);
  const blockers = blockersFor(evidence);
  const unknowns = unknownsFor(evidence);

  const expiresAt = new Date(assessedAt.getTime() + ttlDays * 24 * 60 * 60 * 1000).toISOString();

  /*
   * Order matters. A blocker is settled, so it outranks an open question: a
   * closed business does not become qualifiable by answering everything else.
   */
  if (blockers.length > 0) {
    return { verdict: 'disqualified', total, scores, blockers, unknowns, expiresAt };
  }
  if (unknowns.length > 0) {
    return { verdict: 'eligibility_review', total, scores, blockers, unknowns, expiresAt };
  }
  if (total < QUALIFYING_SCORE) {
    return {
      verdict: 'eligibility_review',
      total,
      scores,
      blockers,
      unknowns: [
        finding('below_threshold', `scored ${total}/${MAX_SCORE}, under the ${QUALIFYING_SCORE} threshold`),
      ],
      expiresAt,
    };
  }
  return { verdict: 'qualified', total, scores, blockers, unknowns, expiresAt };
}

/*
 * Nothing here writes `leads.status`. That column is the outreach lifecycle —
 * new, contacted, replied, suppressed — and a qualification verdict is a
 * different axis. Mapping one onto the other would let a disqualification
 * overwrite a suppression, which is the one lead state that must never be lost.
 * The assessment row is the qualification truth; the workspace joins them.
 */

/** Whether a recorded assessment still stands at a given moment. */
export function assessmentExpired(expiresAt: string, now: Date): boolean {
  const at = Date.parse(expiresAt);
  return Number.isNaN(at) || at <= now.getTime();
}
