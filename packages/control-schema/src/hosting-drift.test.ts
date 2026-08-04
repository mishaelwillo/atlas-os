/**
 * Site hosting observation and drift.
 *
 * Published customer sites are served from Cloudflare Pages, not Railway, and
 * until `ENVIRONMENTS.yaml` grew a hosting section that configuration was
 * prose: the collector could not observe it and drift in it had no detector at
 * all. The hourly `factory.verify_live` sweep catches the symptom — a live site
 * not serving its approved build — but nothing caught the cause.
 *
 * The rule these tests exist to hold is the same one the migration observation
 * holds: an unobserved environment is UNKNOWN, never agreement and never a
 * mismatch against nothing. A collector run without the API environment must
 * not manufacture a blocking finding.
 */
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  collectObservedState,
  type CollectorEnvironment,
  type CollectorFetch,
  type CollectorRun,
} from './collect-observed-state.js';
import { detectDrift, type DesiredState } from './drift.js';

const collectedAt = '2026-08-04T12:00:00.000Z';
const ACCOUNT = 'fd486ea72e20f31937e059f3d14ff0c2';

const environment: CollectorEnvironment = {
  github: { repository: 'example/atlas', branch: 'main' },
  supabase: {
    project_ref: 'example',
    expected_migration: '0001_init',
    required_tables: [],
  },
  railway: {
    api: { public_url: 'https://api.example.test', health_path: '/healthz' },
    os: { public_url: 'https://os.example.test', health_path: '/build-info.json' },
  },
  hosting: {
    provider: 'cloudflare-pages',
    account_id: ACCOUNT,
    pages_project: 'atlas-sites',
    provider_url: 'https://atlas-sites-2np.pages.dev',
    public_base_url: 'https://sites.example.test',
    zone: 'example.test',
    layout: 'path',
    required_variable_names: [
      'CLOUDFLARE_ACCOUNT_ID',
      'CLOUDFLARE_API_TOKEN',
      'CLOUDFLARE_PAGES_PROJECT',
      'ATLAS_SITES_BASE_URL',
    ],
  },
  required_variable_names: ['DATABASE_URL'],
};

const AGREEING: Record<string, string | undefined> = {
  CLOUDFLARE_ACCOUNT_ID: ACCOUNT,
  CLOUDFLARE_API_TOKEN: 'set-but-never-read',
  CLOUDFLARE_PAGES_PROJECT: 'atlas-sites',
  ATLAS_SITES_BASE_URL: 'https://sites.example.test',
};

const run: CollectorRun = async () => ({ stdout: '', stderr: 'unused', exitCode: 1 });

function fetcher(sites: number | 'unreachable' = 404): CollectorFetch {
  return async (input) => {
    const url = String(input);
    if (url.startsWith('https://sites.example.test')) {
      if (sites === 'unreachable') throw new Error('getaddrinfo ENOTFOUND sites.example.test');
      return new Response('', { status: sites });
    }
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  };
}

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'atlas-hosting-'));
  await mkdir(join(root, 'docs', 'control', 'generated'), { recursive: true });
  return root;
}

function desired(): DesiredState {
  return {
    phase: 'P2C',
    phaseComplete: false,
    acceptanceEvidence: [],
    requiredTables: [],
    expectedMigration: '0001_init',
    handoffUpdatedAt: collectedAt,
    staticVerificationFindings: [],
    now: collectedAt,
  };
}

async function codes(
  processEnv: Record<string, string | undefined> | undefined,
  sites: number | 'unreachable' = 404,
): Promise<string[]> {
  const observed = await collectObservedState({
    root: await fixtureRoot(),
    collectedAt,
    environment,
    run,
    fetch: fetcher(sites),
    processEnv,
  });
  return detectDrift(desired(), observed)
    .map((f) => f.code)
    .filter((code) => code.startsWith('hosting.'));
}

describe('hosting observation', () => {
  it('reports no hosting finding when the API agrees with what is declared', async () => {
    expect(await codes(AGREEING)).toEqual([]);
  });

  /** 404 at the base is normal: the placeholder lists nothing. */
  it('treats any answer from the public address as reachable', async () => {
    expect(await codes(AGREEING, 200)).toEqual([]);
    expect(await codes(AGREEING, 404)).toEqual([]);
  });

  it('never reads or stores the credential, only whether it is set', async () => {
    const observed = await collectObservedState({
      root: await fixtureRoot(),
      collectedAt,
      environment,
      run,
      fetch: fetcher(),
      processEnv: { ...AGREEING, CLOUDFLARE_API_TOKEN: 'super-secret-value' },
    });
    expect(observed.hosting.value?.variablesSet.CLOUDFLARE_API_TOKEN).toBe(true);
    expect(JSON.stringify(observed.hosting)).not.toContain('super-secret-value');
  });
});

describe('hosting drift', () => {
  it('flags publishing to an undeclared Pages project', async () => {
    expect(await codes({ ...AGREEING, CLOUDFLARE_PAGES_PROJECT: 'someone-elses-project' })).toEqual([
      'hosting.pages_project_mismatch',
    ]);
  });

  it('flags publishing under an undeclared Cloudflare account', async () => {
    expect(await codes({ ...AGREEING, CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32) })).toEqual([
      'hosting.account_mismatch',
    ]);
  });

  /**
   * The address is recorded on the deployment row and read back to produce a
   * fingerprint, so a wrong base means every recorded address describes
   * somewhere the site is not.
   */
  it('flags a base URL the API records addresses under that is not the declared one', async () => {
    expect(await codes({ ...AGREEING, ATLAS_SITES_BASE_URL: 'https://elsewhere.example.test' })).toEqual([
      'hosting.base_url_mismatch',
    ]);
  });

  /** A trailing slash is not a different address. */
  it('does not flag a base URL that differs only by a trailing slash', async () => {
    expect(await codes({ ...AGREEING, ATLAS_SITES_BASE_URL: 'https://sites.example.test/' })).toEqual(
      [],
    );
  });

  /** Without the credential every approved publish records `queued` instead. */
  it('flags a missing hosting credential', async () => {
    const codesFound = await codes({ ...AGREEING, CLOUDFLARE_API_TOKEN: '' });
    expect(codesFound).toEqual(['hosting.variables_unset']);
  });

  it('flags a public address that does not answer at all', async () => {
    expect(await codes(AGREEING, 'unreachable')).toEqual([
      'hosting.public_address_unreachable',
    ]);
  });

  /**
   * The discipline that matters most. A collector with no API environment
   * knows nothing about hosting, and must say so rather than reporting four
   * mismatches against undefined.
   */
  it('reports unknown rather than drift when the API environment was not injected', async () => {
    expect(await codes(undefined)).toEqual(['hosting.configuration_unknown']);
    expect(await codes({})).toEqual(['hosting.configuration_unknown']);
  });

  it('still reports an unreachable public address as unknown-only when nothing was injected', async () => {
    // The probe ran and failed, but with no configuration to compare against
    // the honest report is that hosting was not observed.
    expect(await codes(undefined, 'unreachable')).toEqual(['hosting.configuration_unknown']);
  });

  it('reports every independent mismatch rather than only the first', async () => {
    const found = await codes(
      {
        CLOUDFLARE_ACCOUNT_ID: 'b'.repeat(32),
        CLOUDFLARE_PAGES_PROJECT: 'wrong-project',
        ATLAS_SITES_BASE_URL: 'https://elsewhere.example.test',
        CLOUDFLARE_API_TOKEN: '',
      },
      'unreachable',
    );
    expect(found).toEqual([
      'hosting.account_mismatch',
      'hosting.base_url_mismatch',
      'hosting.pages_project_mismatch',
      'hosting.public_address_unreachable',
      'hosting.variables_unset',
    ]);
  });
});

describe('the declared production hosting section', () => {
  /**
   * The file is the authority for what the collector compares against, so a
   * malformed section must fail before it can produce a confident wrong
   * answer. Written as a fixture rather than read from the repo so this tests
   * the schema, not today's values.
   */
  it('requires a hosting section on every environment', async () => {
    const { EnvironmentFileSchema } = await import('./schemas.js');
    const base = {
      github: { repository: 'example/atlas', branch: 'main' },
      supabase: { project_ref: 'x', expected_migration: '0001_init', required_tables: [] },
      railway: {
        api: { public_url: 'https://api.example.test', health_path: '/healthz' },
        os: { public_url: 'https://os.example.test', health_path: '/build-info.json' },
      },
      required_variable_names: ['DATABASE_URL'],
    };
    expect(() =>
      EnvironmentFileSchema.parse({ schema_version: 1, environments: { production: base } }),
    ).toThrow();

    const hosting = {
      provider: 'cloudflare-pages',
      account_id: ACCOUNT,
      pages_project: 'atlas-sites',
      provider_url: 'https://atlas-sites.pages.dev',
      public_base_url: 'https://sites.example.test',
      zone: 'example.test',
      layout: 'path',
      required_variable_names: ['CLOUDFLARE_API_TOKEN'],
    };
    expect(() =>
      EnvironmentFileSchema.parse({
        schema_version: 1,
        environments: { production: { ...base, hosting } },
      }),
    ).not.toThrow();

    // An account id that is not 32 hex characters is not an account id.
    expect(() =>
      EnvironmentFileSchema.parse({
        schema_version: 1,
        environments: {
          production: { ...base, hosting: { ...hosting, account_id: 'not-an-account' } },
        },
      }),
    ).toThrow();
  });
});
