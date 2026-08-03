/**
 * Migration files must not claim whether they have been applied.
 *
 * Every migration in this repository was written with a `REVIEW ONLY — NOT
 * APPLIED` banner, and every one of them became false the moment it ran. The
 * banners were never updated, because nothing checked them: `0002` through
 * `0006` all shipped saying no database had run them, while the ledger said
 * otherwise. A stale claim in a reviewed file is worse than no claim, because a
 * reader has no reason to doubt it.
 *
 * The fix is not to keep the banners current — that is the manual step that
 * failed. It is to remove the claim from the file entirely and let the one
 * authority answer: `expected_migration` in `ENVIRONMENTS.yaml`, which the
 * drift collector already compares against the live migration ledger. A file
 * that asserts nothing cannot go stale.
 *
 * So this refuses any applied-state assertion in a migration, and the runbook's
 * rule that an applied migration is immutable is preserved in the way that
 * matters: no statement changes, only a comment that was making a false claim.
 */

/**
 * Phrases that assert whether a migration has run.
 *
 * Deliberately broad in both directions: "APPLIED" goes stale as soon as it is
 * true, and "NOT APPLIED" goes stale as soon as it stops being. Neither belongs
 * in a file that cannot know.
 */
const APPLIED_STATE_CLAIMS: readonly RegExp[] = [
  /\bREVIEW ONLY\b/i,
  /\bNOT APPLIED\b/i,
  /\bNOT BEEN APPLIED\b/i,
  /\bHAS BEEN APPLIED\b/i,
  /\bALREADY APPLIED\b/i,
  /\bno (?:production )?database has run this file\b/i,
];

export interface BannerFinding {
  /** Repository-relative path of the migration. */
  path: string;
  /** The offending line, trimmed. */
  line: string;
  lineNumber: number;
}

/**
 * Find applied-state claims in one migration's text.
 *
 * Only comment lines are inspected. A string literal inside a statement that
 * happens to contain one of these phrases is data the migration writes, not a
 * claim the file is making about itself.
 */
export function findAppliedStateClaims(path: string, sql: string): BannerFinding[] {
  const found: BannerFinding[] = [];
  sql.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line.startsWith('--')) return;
    if (APPLIED_STATE_CLAIMS.some((pattern) => pattern.test(line))) {
      found.push({ path, line, lineNumber: index + 1 });
    }
  });
  return found;
}

/** Message for a finding, naming the authority that should have been consulted. */
export function bannerMessage(finding: BannerFinding): string {
  return `line ${finding.lineNumber} claims applied state ("${finding.line.slice(0, 80)}"); a migration cannot know whether it has run — expected_migration in ENVIRONMENTS.yaml is the authority`;
}
