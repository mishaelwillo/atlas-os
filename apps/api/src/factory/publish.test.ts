/**
 * Publish and rollback rules (docs/specs/p2/website-factory.md).
 * Acceptance: "public fingerprint equals approved build; rollback proves
 * previous fingerprint healthy."
 */
import { describe, expect, it } from 'vitest';
import {
  planPublish,
  planRollback,
  planSiblings,
  type DeploymentRecord,
  type LiveSibling,
} from './publish.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);

const base = {
  approvedBuildHash: HASH_A,
  currentBuildHash: HASH_A,
  renderIssues: [],
  qaFailures: [],
  latestVersion: 0,
  live: null,
};

describe('publish planning', () => {
  it('promotes an approved build as the next version', () => {
    const plan = planPublish(base);
    expect(plan).toMatchObject({ ok: true, version: 1, buildHash: HASH_A, supersedes: null });
  });

  it('records which deployment it supersedes', () => {
    const plan = planPublish({
      ...base,
      latestVersion: 3,
      live: { deploymentId: 'dep-3', version: 3, buildHash: HASH_B },
    });
    expect(plan).toMatchObject({ ok: true, version: 4, supersedes: 'dep-3' });
  });

  /**
   * The heart of the acceptance. The approved hash is re-derived rather than
   * trusted, so a descriptor edited between approval and publish cannot put
   * something live that nobody approved.
   */
  it('refuses when the descriptor changed after approval', () => {
    const refusal = planPublish({ ...base, currentBuildHash: HASH_B });
    expect(refusal).toMatchObject({ ok: false, code: 'build_changed_since_approval' });
    if (refusal.ok) throw new Error('expected refusal');
    expect(refusal.message).toContain(HASH_A.slice(0, 12));
    expect(refusal.message).toContain(HASH_B.slice(0, 12));
  });

  it('refuses when the descriptor no longer renders and reports why', () => {
    const refusal = planPublish({
      ...base,
      currentBuildHash: null,
      renderIssues: [{ code: 'section_facts_missing', detail: "section 'contact' requires phone" }],
    });
    expect(refusal).toMatchObject({ ok: false, code: 'template_unsatisfied' });
    if (refusal.ok) throw new Error('expected refusal');
    expect(refusal.issues).toHaveLength(1);
  });

  /**
   * The QA acceptance: a build that fails a required check cannot reach an
   * approved publish, whatever was approved earlier.
   */
  it('refuses a build that fails a required QA check and names it', () => {
    const refusal = planPublish({ ...base, qaFailures: ['accessibility.single-h1'] });
    expect(refusal).toMatchObject({ ok: false, code: 'qa_failed' });
    if (refusal.ok) throw new Error('expected refusal');
    expect(refusal.qaFailures).toEqual(['accessibility.single-h1']);
    expect(refusal.message).toContain('accessibility.single-h1');
  });

  /**
   * A failing check outranks a matching fingerprint: approving the right bytes
   * does not make those bytes publishable.
   */
  it('refuses on QA even when the approved build still matches', () => {
    const refusal = planPublish({
      ...base,
      qaFailures: ['security.csp'],
      live: { deploymentId: 'dep-1', version: 1, buildHash: HASH_B },
    });
    expect(refusal).toMatchObject({ ok: false, code: 'qa_failed' });
  });

  /** Re-publishing an identical build would add a version that changes nothing. */
  it('refuses when the same build is already live', () => {
    const refusal = planPublish({
      ...base,
      live: { deploymentId: 'dep-1', version: 1, buildHash: HASH_A },
    });
    expect(refusal).toMatchObject({ ok: false, code: 'already_live' });
  });

  it('permits promoting over a different live build', () => {
    const plan = planPublish({
      ...base,
      latestVersion: 1,
      live: { deploymentId: 'dep-1', version: 1, buildHash: HASH_B },
    });
    expect(plan.ok).toBe(true);
  });
});

const dep = (over: Partial<DeploymentRecord>): DeploymentRecord => ({
  deploymentId: 'dep',
  version: 1,
  buildHash: HASH_A,
  status: 'superseded',
  wentLive: true,
  html: '<html>a</html>',
  ...over,
});

describe('rollback planning', () => {
  /**
   * A hash cannot be republished, and re-rendering the descriptor does not
   * recover the old build — the descriptor is the thing that changed, which is
   * usually why someone is rolling back.
   */
  it('restores the bytes the target actually published', () => {
    const plan = planRollback(
      [
        dep({ deploymentId: 'dep-1', version: 1, buildHash: HASH_A, html: '<html>one</html>' }),
        dep({ deploymentId: 'dep-2', version: 2, buildHash: HASH_B, status: 'live' }),
      ],
      2,
    );
    expect(plan).toMatchObject({ ok: true, html: '<html>one</html>' });
    if (!plan.ok) throw new Error('expected a plan');
    expect(plan.target.deploymentId).toBe('dep-1');
  });

  /** Rendering something else would republish a build nobody approved. */
  it('refuses when the healthy predecessor predates build retention', () => {
    const refusal = planRollback(
      [
        dep({ deploymentId: 'dep-1', version: 1, buildHash: HASH_A, html: null }),
        dep({ deploymentId: 'dep-2', version: 2, buildHash: HASH_B, status: 'live' }),
      ],
      2,
    );
    expect(refusal).toMatchObject({ ok: false, code: 'no_stored_build' });
  });

  it('skips a predecessor with no bytes for one that has them', () => {
    const plan = planRollback(
      [
        dep({ deploymentId: 'dep-1', version: 1, buildHash: HASH_A, html: '<html>one</html>' }),
        dep({ deploymentId: 'dep-2', version: 2, buildHash: HASH_C, html: null }),
        dep({ deploymentId: 'dep-3', version: 3, buildHash: HASH_B, status: 'live' }),
      ],
      3,
    );
    expect(plan).toMatchObject({ ok: true });
    if (!plan.ok) throw new Error('expected a plan');
    expect(plan.target.deploymentId).toBe('dep-1');
  });

  it('restores the most recent previously-live build', () => {
    const plan = planRollback(
      [
        dep({ deploymentId: 'dep-3', version: 3, buildHash: HASH_C, status: 'live' }),
        dep({ deploymentId: 'dep-2', version: 2, buildHash: HASH_B }),
        dep({ deploymentId: 'dep-1', version: 1, buildHash: HASH_A }),
      ],
      3,
    );
    expect(plan).toMatchObject({ ok: true, version: 4, supersedes: 'dep-3' });
    if (!plan.ok) throw new Error('expected a plan');
    expect(plan.target).toMatchObject({ deploymentId: 'dep-2', buildHash: HASH_B });
  });

  /**
   * "Proves previous fingerprint healthy" is the requirement. A build that was
   * queued and never served has proven nothing, so restoring it would be a
   * fresh deploy wearing a rollback's clothes.
   */
  it('skips a deployment that never actually went live', () => {
    const plan = planRollback(
      [
        dep({ deploymentId: 'dep-3', version: 3, buildHash: HASH_C, status: 'live' }),
        dep({ deploymentId: 'dep-2', version: 2, buildHash: HASH_B, status: 'failed', wentLive: false }),
        dep({ deploymentId: 'dep-1', version: 1, buildHash: HASH_A }),
      ],
      3,
    );
    if (!plan.ok) throw new Error('expected a plan');
    expect(plan.target.deploymentId).toBe('dep-1');
  });

  it('refuses when nothing is live', () => {
    const plan = planRollback([dep({ status: 'superseded' })], 1);
    expect(plan).toMatchObject({ ok: false, code: 'no_live_deployment' });
  });

  it('refuses when no earlier deployment was ever live', () => {
    const plan = planRollback(
      [
        dep({ deploymentId: 'dep-2', version: 2, buildHash: HASH_B, status: 'live' }),
        dep({ deploymentId: 'dep-1', version: 1, buildHash: HASH_A, status: 'failed', wentLive: false }),
      ],
      2,
    );
    expect(plan).toMatchObject({ ok: false, code: 'no_healthy_predecessor' });
  });

  it('refuses the first ever deployment, which has no predecessor', () => {
    const plan = planRollback(
      [dep({ deploymentId: 'dep-1', version: 1, buildHash: HASH_A, status: 'live' })],
      1,
    );
    expect(plan).toMatchObject({ ok: false, code: 'no_healthy_predecessor' });
  });

  /** Rolling back to an identical build would change nothing. */
  it('ignores an earlier deployment carrying the same build as the live one', () => {
    const plan = planRollback(
      [
        dep({ deploymentId: 'dep-2', version: 2, buildHash: HASH_A, status: 'live' }),
        dep({ deploymentId: 'dep-1', version: 1, buildHash: HASH_A }),
      ],
      2,
    );
    expect(plan).toMatchObject({ ok: false, code: 'no_healthy_predecessor' });
  });

  /** History stays append-only: a restore is a new version, never a revival. */
  it('records the restore as a new version rather than reviving the old row', () => {
    const plan = planRollback(
      [
        dep({ deploymentId: 'dep-2', version: 2, buildHash: HASH_B, status: 'live' }),
        dep({ deploymentId: 'dep-1', version: 1, buildHash: HASH_A }),
      ],
      2,
    );
    if (!plan.ok) throw new Error('expected a plan');
    expect(plan.version).toBe(3);
    expect(plan.target.version).toBe(1);
  });
});

/**
 * Providers that deploy a whole-site snapshot replace everything each time, so
 * every live site has to be re-sent with each publish or it goes dark. That
 * happened in production: publishing a second site left the first answering 404
 * while its deployment row still read `live`.
 */
describe('keeping already-live sites served', () => {
  function sibling(overrides: Partial<LiveSibling> = {}): LiveSibling {
    return {
      siteId: 'site-1',
      slug: 'bravo-plumbing-2b3c4d5e',
      recordedBuildHash: HASH_B,
      renderedHash: HASH_B,
      html: '<html>Bravo</html>',
      ...overrides,
    };
  }

  it('passes through every site that still reproduces its approved build', () => {
    const plan = planSiblings([
      sibling(),
      sibling({ siteId: 'site-2', slug: 'charlie-roofing-3c', recordedBuildHash: HASH_C, renderedHash: HASH_C, html: '<html>C</html>' }),
    ]);
    expect(plan).toMatchObject({ ok: true });
    if (!plan.ok) throw new Error('expected a plan');
    expect(plan.sites.map((s) => s.slug)).toEqual(['bravo-plumbing-2b3c4d5e', 'charlie-roofing-3c']);
  });

  it('is satisfied by nothing else being live', () => {
    expect(planSiblings([])).toMatchObject({ ok: true, sites: [] });
  });

  /**
   * Refusing is the least-bad option. Dropping the site takes a paying customer
   * offline; shipping the new bytes publishes something nobody approved.
   */
  it('refuses when a live site no longer reproduces its approved build', () => {
    const refusal = planSiblings([sibling({ renderedHash: HASH_C })]);
    expect(refusal).toMatchObject({ ok: false, code: 'sibling_build_drifted' });
    if (refusal.ok) throw new Error('expected refusal');
    expect(refusal.sites).toEqual(['bravo-plumbing-2b3c4d5e']);
    expect(refusal.message).toContain('nobody approved');
  });

  it('refuses when a live site no longer renders at all', () => {
    const refusal = planSiblings([sibling({ renderedHash: null, html: null })]);
    expect(refusal).toMatchObject({ ok: false, code: 'sibling_unrenderable' });
    if (refusal.ok) throw new Error('expected refusal');
    expect(refusal.sites).toEqual(['bravo-plumbing-2b3c4d5e']);
  });

  /** An unrenderable site is reported as such, not as drift. */
  it('reports unrenderable ahead of drifted', () => {
    const refusal = planSiblings([
      sibling({ renderedHash: null, html: null }),
      sibling({ siteId: 'site-2', slug: 'other', renderedHash: HASH_C }),
    ]);
    expect(refusal).toMatchObject({ ok: false, code: 'sibling_unrenderable' });
  });
});
