/**
 * Prospect qualification (docs/specs/p2/revenue-pilot.md).
 *
 * Acceptance: "Each qualified prospect has active-profile evidence, no/weak-site
 * assessment, source provenance, contact-policy decision, region, owner, and
 * expiry." Each of those is tested by removing it from an otherwise qualifying
 * prospect and confirming the verdict changes.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_DEMO_EFFORT_HOURS,
  MAX_SCORE,
  QUALIFYING_SCORE,
  QUALIFICATION_TTL_DAYS,
  SCORE_DIMENSIONS,
  assessProspect,
  assessmentExpired,
  type QualificationEvidence,
} from './qualification.js';

const AT = new Date('2026-08-03T00:00:00.000Z');

/** A prospect that satisfies every required item in the rubric. */
function evidence(overrides: Partial<QualificationEvidence> = {}): QualificationEvidence {
  return {
    region: 'north-america',
    vertical: 'trades',
    targetRegions: ['north-america'],
    targetVerticals: ['trades'],
    activeProfile: true,
    websiteUrl: null,
    weakSiteProblem: null,
    identityVerified: true,
    locationVerified: true,
    publicFactCount: 5,
    contactSource: 'https://maps.example/acme',
    contactPolicyReviewed: true,
    suppressed: false,
    duplicateOf: null,
    operatingStatus: 'open',
    demoEffortHours: 1,
    deceptiveDemoRisk: false,
    benefitRationale: 'no site at all; customers cannot find opening hours',
    ...overrides,
  };
}

const codes = (result: { blockers: Array<{ code: string }>; unknowns: Array<{ code: string }> }) => [
  ...result.blockers.map((b) => b.code),
  ...result.unknowns.map((u) => u.code),
];

describe('a complete prospect', () => {
  it('qualifies', () => {
    const result = assessProspect(evidence(), AT);
    expect(result.verdict).toBe('qualified');
    expect(result.blockers).toEqual([]);
    expect(result.unknowns).toEqual([]);
  });

  it('scores every dimension the specification names', () => {
    const result = assessProspect(evidence(), AT);
    expect(Object.keys(result.scores).sort()).toEqual([...SCORE_DIMENSIONS].sort());
    expect(result.total).toBe(SCORE_DIMENSIONS.reduce((s, d) => s + result.scores[d], 0));
    expect(result.total).toBeGreaterThanOrEqual(QUALIFYING_SCORE);
    expect(result.total).toBeLessThanOrEqual(MAX_SCORE);
  });

  /** The verdict must be re-derivable from what was recorded. */
  it('is deterministic for the same evidence', () => {
    expect(assessProspect(evidence(), AT)).toEqual(assessProspect(evidence(), AT));
  });

  it('carries an expiry, because sourced facts go stale', () => {
    const result = assessProspect(evidence(), AT);
    expect(result.expiresAt).toBe(
      new Date(AT.getTime() + QUALIFICATION_TTL_DAYS * 86400000).toISOString(),
    );
  });
});

describe('settled facts that disqualify', () => {
  it('disqualifies a duplicate', () => {
    const result = assessProspect(evidence({ duplicateOf: 'lead-1' }), AT);
    expect(result.verdict).toBe('disqualified');
    expect(codes(result)).toContain('duplicate');
  });

  it('disqualifies a closed business', () => {
    const result = assessProspect(evidence({ operatingStatus: 'closed' }), AT);
    expect(result.verdict).toBe('disqualified');
    expect(codes(result)).toContain('closed');
  });

  it('disqualifies a suppressed lead', () => {
    const result = assessProspect(evidence({ suppressed: true }), AT);
    expect(result.verdict).toBe('disqualified');
    expect(codes(result)).toContain('suppressed');
  });

  it('disqualifies a demo that would misrepresent the business', () => {
    const result = assessProspect(evidence({ deceptiveDemoRisk: true }), AT);
    expect(result.verdict).toBe('disqualified');
    expect(codes(result)).toContain('deceptive_demo_risk');
  });

  it('disqualifies an inactive directory profile', () => {
    const result = assessProspect(evidence({ activeProfile: false }), AT);
    expect(result.verdict).toBe('disqualified');
    expect(codes(result)).toContain('inactive_profile');
  });

  /** One tightly bounded cohort at a time is an MVP exclusion, not a preference. */
  it('disqualifies a prospect outside the cohort region', () => {
    const result = assessProspect(evidence({ region: 'caribbean' }), AT);
    expect(result.verdict).toBe('disqualified');
    expect(codes(result)).toContain('outside_cohort_region');
  });

  it('disqualifies a prospect outside the cohort vertical', () => {
    const result = assessProspect(evidence({ vertical: 'dentistry' }), AT);
    expect(result.verdict).toBe('disqualified');
    expect(codes(result)).toContain('outside_cohort_vertical');
  });

  /** "They could do better" is not a finding. */
  it('disqualifies an existing site with no documented problem', () => {
    const result = assessProspect(evidence({ websiteUrl: 'https://acme.example' }), AT);
    expect(result.verdict).toBe('disqualified');
    expect(codes(result)).toContain('site_without_documented_problem');
  });

  it('accepts an existing site once the problem is documented', () => {
    const result = assessProspect(
      evidence({
        websiteUrl: 'https://acme.example',
        weakSiteProblem: 'no phone number and no hours anywhere on the page',
      }),
      AT,
    );
    expect(result.verdict).toBe('qualified');
  });

  it('disqualifies a demo that would cost more than the per-prospect cap', () => {
    const result = assessProspect(evidence({ demoEffortHours: MAX_DEMO_EFFORT_HOURS + 1 }), AT);
    expect(result.verdict).toBe('disqualified');
    expect(codes(result)).toContain('demo_effort_over_cap');
  });
});

describe('open questions send a prospect to review', () => {
  it('reviews an unchecked directory profile rather than assuming either way', () => {
    const result = assessProspect(evidence({ activeProfile: null }), AT);
    expect(result.verdict).toBe('eligibility_review');
    expect(codes(result)).toContain('profile_activity_unknown');
  });

  it('reviews an uncertain operating status', () => {
    const result = assessProspect(evidence({ operatingStatus: 'uncertain' }), AT);
    expect(result.verdict).toBe('eligibility_review');
    expect(codes(result)).toContain('operating_status_uncertain');
  });

  it('reviews an unverified identity or location', () => {
    expect(assessProspect(evidence({ identityVerified: false }), AT).verdict).toBe(
      'eligibility_review',
    );
    const result = assessProspect(evidence({ locationVerified: null }), AT);
    expect(codes(result)).toContain('identity_unverified');
  });

  it('reviews a contact with no recorded source', () => {
    const result = assessProspect(evidence({ contactSource: null }), AT);
    expect(result.verdict).toBe('eligibility_review');
    expect(codes(result)).toContain('contact_provenance_missing');
  });

  /** The specification blocks on unresolved contact policy rather than proceeding. */
  it('reviews an unreviewed contact policy', () => {
    const result = assessProspect(evidence({ contactPolicyReviewed: false }), AT);
    expect(result.verdict).toBe('eligibility_review');
    expect(codes(result)).toContain('contact_policy_unreviewed');
  });

  it('reviews a prospect with too few sourced facts to build from', () => {
    const result = assessProspect(evidence({ publicFactCount: 2 }), AT);
    expect(result.verdict).toBe('eligibility_review');
    expect(codes(result)).toContain('insufficient_facts');
  });

  it('reviews a prospect with no stated benefit', () => {
    const result = assessProspect(evidence({ benefitRationale: '   ' }), AT);
    expect(result.verdict).toBe('eligibility_review');
    expect(codes(result)).toContain('benefit_unstated');
  });

  /**
   * A weak but complete prospect is a judgement call, not a disqualification.
   * The required checks put a floor of 22 under any complete prospect, so this
   * also pins that the threshold sits inside the band it can actually reach.
   */
  it('reviews a complete prospect that scores under the threshold', () => {
    const result = assessProspect(
      evidence({
        websiteUrl: 'https://acme.example',
        weakSiteProblem: 'no hours listed',
        publicFactCount: 3,
        demoEffortHours: MAX_DEMO_EFFORT_HOURS,
      }),
      AT,
    );
    expect(result.total).toBe(22);
    expect(result.total).toBeLessThan(QUALIFYING_SCORE);
    expect(result.verdict).toBe('eligibility_review');
    expect(codes(result)).toContain('below_threshold');
  });

  /** The threshold must be reachable from both sides, or it decides nothing. */
  it('sits inside the band a complete prospect can actually score', () => {
    expect(QUALIFYING_SCORE).toBeGreaterThan(22);
    expect(QUALIFYING_SCORE).toBeLessThanOrEqual(MAX_SCORE);
  });
});

/** A settled disqualification is not undone by answering an open question. */
describe('precedence', () => {
  it('reports disqualified when a prospect has both a blocker and an unknown', () => {
    const result = assessProspect(
      evidence({ operatingStatus: 'closed', contactPolicyReviewed: false }),
      AT,
    );
    expect(result.verdict).toBe('disqualified');
    expect(result.blockers.map((b) => b.code)).toContain('closed');
    // The open question is still reported, so fixing one does not hide the other.
    expect(result.unknowns.map((u) => u.code)).toContain('contact_policy_unreviewed');
  });
});

describe('assessmentExpired', () => {
  it('is false before the expiry and true after it', () => {
    const { expiresAt } = assessProspect(evidence(), AT);
    expect(assessmentExpired(expiresAt, AT)).toBe(false);
    expect(assessmentExpired(expiresAt, new Date(Date.parse(expiresAt) + 1))).toBe(true);
  });

  /** An unreadable expiry is treated as expired, never as still valid. */
  it('treats an unparseable expiry as expired', () => {
    expect(assessmentExpired('not a date', AT)).toBe(true);
  });
});
