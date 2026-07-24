import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { parse } from 'yaml';
import {
  RegionPackSchema,
  resolveRegionPack,
  validateRegionPacks,
  type RegionPack,
} from './regions.js';

const repositoryRoot = resolve(import.meta.dirname, '..', '..', '..');
const regionsRoot = resolve(repositoryRoot, 'docs', 'control', 'regions');
const regionIds = [
  'global',
  'north-america',
  'united-states',
  'canada',
  'caribbean',
  'saint-lucia',
  'jamaica',
  'trinidad-and-tobago',
] as const;

function loadCanonicalPacks(): RegionPack[] {
  return regionIds.map((id) =>
    RegionPackSchema.parse(
      parse(readFileSync(resolve(regionsRoot, `${id}.yaml`), 'utf8')),
    ),
  );
}

const globalPack = {
  schema_version: 1,
  id: 'global',
  countries: [],
  languages: ['en'],
  currencies: [],
  preferred_channels: ['email', 'phone'],
  phone_regions: [],
  directories: ['google-business-profile'],
  review_platforms: ['google'],
  outreach_policy: {
    default_autonomy: 'shadow',
    require_operator_approval: true,
    policy_review_required: true,
  },
  seo: { location_depth: 'country-and-locality' },
} satisfies RegionPack;

describe('regional pack inheritance', () => {
  test('Saint Lucia inherits global English and Caribbean WhatsApp, then overrides currency', () => {
    const resolved = resolveRegionPack('saint-lucia', loadCanonicalPacks());

    expect(resolved.languages).toContain('en');
    expect(resolved.preferred_channels[0]).toBe('whatsapp');
    expect(resolved.currencies).toEqual(['XCD']);
    expect(resolved.outreach_policy).toEqual({
      default_autonomy: 'shadow',
      require_operator_approval: true,
      policy_review_required: true,
    });
  });

  test('the United States inherits North America and overrides currency to USD', () => {
    const packs = loadCanonicalPacks();
    const resolved = resolveRegionPack('united-states', packs);

    expect(resolved.inheritance_chain).toEqual([
      'global',
      'north-america',
      'united-states',
    ]);
    expect(resolved.currencies).toEqual(['USD']);
    expect(resolved.countries).toEqual(['US']);
  });

  test('resolution is deterministic regardless of input order', () => {
    const packs = loadCanonicalPacks();

    expect(resolveRegionPack('jamaica', [...packs].reverse())).toEqual(
      resolveRegionPack('jamaica', packs),
    );
  });

  test('a child replaces supplied values and inherits omitted values', () => {
    const parent = {
      ...globalPack,
      id: 'parent',
      currencies: ['USD'],
      preferred_channels: ['email', 'phone'],
    } satisfies RegionPack;
    const child = {
      schema_version: 1,
      id: 'child',
      inherits: 'parent',
      currencies: ['XCD'],
    } satisfies RegionPack;

    const resolved = resolveRegionPack('child', [child, parent]);

    expect(resolved.currencies).toEqual(['XCD']);
    expect(resolved.preferred_channels).toEqual(['email', 'phone']);
    expect(resolved.languages).toEqual(['en']);
  });
});

describe('regional pack validation', () => {
  test('all canonical packs validate and resolve', () => {
    const packs = loadCanonicalPacks();

    expect(validateRegionPacks(packs)).toHaveLength(regionIds.length);
    for (const id of regionIds) {
      expect(resolveRegionPack(id, packs).id).toBe(id);
    }
  });

  test.each([
    ['country', { countries: ['USA'] }],
    ['currency', { currencies: ['usd'] }],
    ['language', { languages: ['english'] }],
    ['phone region', { phone_regions: ['1'] }],
    ['channel', { preferred_channels: ['fax'] }],
    ['directory', { directories: ['invented-directory'] }],
    ['review platform', { review_platforms: ['invented-review-site'] }],
  ])('rejects an invalid %s code or enum', (_label, patch) => {
    expect(() => RegionPackSchema.parse({ ...globalPack, ...patch })).toThrow();
  });

  test('rejects unknown keys', () => {
    expect(() =>
      RegionPackSchema.parse({ ...globalPack, legal_conclusion: 'allowed' }),
    ).toThrow();
  });

  test('rejects duplicate pack IDs', () => {
    expect(() => validateRegionPacks([globalPack, globalPack])).toThrow(
      /duplicate region pack id/i,
    );
  });

  test('rejects an unknown parent', () => {
    expect(() =>
      validateRegionPacks([
        globalPack,
        { schema_version: 1, id: 'child', inherits: 'missing' },
      ]),
    ).toThrow(/unknown parent/i);
  });

  test('rejects inheritance cycles', () => {
    expect(() =>
      validateRegionPacks([
        { schema_version: 1, id: 'first', inherits: 'second' },
        { schema_version: 1, id: 'second', inherits: 'first' },
      ]),
    ).toThrow(/inheritance cycle/i);
  });

  test('requires a fully resolved root policy and preserves safe outreach defaults', () => {
    expect(() =>
      validateRegionPacks([{ schema_version: 1, id: 'global' }]),
    ).toThrow(/could not resolve required regional field/i);

    expect(() =>
      validateRegionPacks([
        {
          ...globalPack,
          outreach_policy: {
            default_autonomy: 'full-auto',
            require_operator_approval: false,
            policy_review_required: false,
          },
        },
      ]),
    ).toThrow();
  });
});
