/**
 * Migration files must not claim whether they have been applied.
 *
 * Every banner in this repository went stale the moment its migration ran, and
 * nothing noticed because nothing checked. These tests pin the rule that
 * replaced them: the claim itself is the defect, so a file asserting either
 * direction fails, and `expected_migration` is left as the single authority.
 */
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { bannerMessage, findAppliedStateClaims } from './migration-banner.js';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

describe('findAppliedStateClaims', () => {
  /** The exact banner every migration in this repository shipped with. */
  it('catches the banner that went stale', () => {
    const found = findAppliedStateClaims(
      'x.sql',
      '-- ATLAS OS — 0007\n-- REVIEW ONLY — NOT APPLIED. No database has run this file.\ncreate table t ();\n',
    );
    expect(found).toHaveLength(1);
    expect(found[0].lineNumber).toBe(2);
  });

  /**
   * Keeping a banner current is the manual step that failed, so a claim in the
   * other direction is refused too — it goes stale the moment it is written.
   */
  it('catches a claim that the migration has been applied', () => {
    expect(findAppliedStateClaims('x.sql', '-- this has been applied\n')).toHaveLength(1);
    expect(findAppliedStateClaims('x.sql', '-- already applied to production\n')).toHaveLength(1);
    expect(findAppliedStateClaims('x.sql', '-- has not been applied yet\n')).toHaveLength(1);
  });

  it('accepts a migration that says nothing about applied state', () => {
    const sql = [
      '-- ATLAS OS — 0007: something (P3-X-001)',
      '-- Applied state lives in docs/control/ENVIRONMENTS.yaml (expected_migration).',
      '--',
      '-- COUPLING: applying this requires bumping expected_migration.',
      'create table t ();',
    ].join('\n');
    expect(findAppliedStateClaims('x.sql', sql)).toEqual([]);
  });

  /**
   * Only comments are inspected. A migration that writes one of these phrases
   * as data is describing a row, not making a claim about itself.
   */
  it('ignores the phrase inside a statement', () => {
    const sql = `insert into notes (body) values ('review only, not applied');\n`;
    expect(findAppliedStateClaims('x.sql', sql)).toEqual([]);
  });

  it('reports the line and points at the authority', () => {
    const [finding] = findAppliedStateClaims('x.sql', '-- REVIEW ONLY\n');
    expect(bannerMessage(finding)).toContain('line 1');
    expect(bannerMessage(finding)).toContain('ENVIRONMENTS.yaml');
  });
});

/**
 * The regression this exists to prevent. `0002` through `0006` all shipped
 * saying no database had run them, while the ledger said otherwise.
 */
describe('the committed migrations', () => {
  it('claim nothing about whether they have been applied', async () => {
    const root = join(repositoryRoot, 'supabase', 'migrations');
    const files = (await readdir(root)).filter((f) => f.endsWith('.sql')).sort();
    expect(files.length).toBeGreaterThan(0);

    const claims = [];
    for (const file of files) {
      claims.push(...findAppliedStateClaims(file, await readFile(join(root, file), 'utf8')));
    }
    expect(claims.map((c) => `${c.path}:${c.lineNumber}`)).toEqual([]);
  });
});
