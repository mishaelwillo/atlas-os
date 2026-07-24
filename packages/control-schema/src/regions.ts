import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';

const RegionIdSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const CountryCodeSchema = z.string().regex(/^[A-Z]{2}$/);
const CurrencyCodeSchema = z.string().regex(/^[A-Z]{3}$/);
const LanguageCodeSchema = z
  .string()
  .regex(/^[a-z]{2,3}(?:-(?:[A-Z]{2}|[0-9]{3}))?$/);

export const OutreachChannelSchema = z.enum([
  'whatsapp',
  'email',
  'phone',
  'sms',
  'social-dm',
]);

export const DirectorySchema = z.enum([
  'google-business-profile',
  'apple-business-connect',
  'bing-places',
]);

export const ReviewPlatformSchema = z.enum([
  'google',
  'facebook',
  'tripadvisor',
  'yelp',
]);

const OutreachPolicyOverrideSchema = z
  .object({
    default_autonomy: z.literal('shadow').optional(),
    require_operator_approval: z.literal(true).optional(),
    policy_review_required: z.literal(true).optional(),
  })
  .strict();

const SeoOverrideSchema = z
  .object({
    location_depth: z
      .enum([
        'country',
        'locality',
        'country-and-locality',
        'subdivision-and-locality',
      ])
      .optional(),
  })
  .strict();

export const RegionPackSchema = z
  .object({
    schema_version: z.literal(1),
    id: RegionIdSchema,
    inherits: RegionIdSchema.optional(),
    countries: z.array(CountryCodeSchema).optional(),
    languages: z.array(LanguageCodeSchema).optional(),
    currencies: z.array(CurrencyCodeSchema).optional(),
    preferred_channels: z.array(OutreachChannelSchema).optional(),
    phone_regions: z.array(CountryCodeSchema).optional(),
    directories: z.array(DirectorySchema).optional(),
    review_platforms: z.array(ReviewPlatformSchema).optional(),
    outreach_policy: OutreachPolicyOverrideSchema.optional(),
    seo: SeoOverrideSchema.optional(),
  })
  .strict();

const ResolvedRegionPackShapeSchema = z
  .object({
    schema_version: z.literal(1),
    id: RegionIdSchema,
    inherits: RegionIdSchema.optional(),
    inheritance_chain: z.array(RegionIdSchema).min(1),
    countries: z.array(CountryCodeSchema),
    languages: z.array(LanguageCodeSchema).min(1),
    currencies: z.array(CurrencyCodeSchema),
    preferred_channels: z.array(OutreachChannelSchema).min(1),
    phone_regions: z.array(CountryCodeSchema),
    directories: z.array(DirectorySchema).min(1),
    review_platforms: z.array(ReviewPlatformSchema).min(1),
    outreach_policy: z
      .object({
        default_autonomy: z.literal('shadow'),
        require_operator_approval: z.literal(true),
        policy_review_required: z.literal(true),
      })
      .strict(),
    seo: z
      .object({
        location_depth: z.enum([
          'country',
          'locality',
          'country-and-locality',
          'subdivision-and-locality',
        ]),
      })
      .strict(),
  })
  .strict();

export type RegionPack = z.infer<typeof RegionPackSchema>;
export type ResolvedRegionPack = z.infer<typeof ResolvedRegionPackShapeSchema>;

function stableUnique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function packMap(packs: readonly RegionPack[]): Map<string, RegionPack> {
  const byId = new Map<string, RegionPack>();
  for (const pack of packs) {
    if (byId.has(pack.id)) {
      throw new Error(`Duplicate region pack ID: ${pack.id}`);
    }
    byId.set(pack.id, pack);
  }
  return byId;
}

export function resolveRegionPack(
  id: string,
  packs: readonly RegionPack[],
): ResolvedRegionPack {
  const byId = packMap(packs);
  const visiting: string[] = [];

  function visit(currentId: string): Record<string, unknown> {
    const cycleIndex = visiting.indexOf(currentId);
    if (cycleIndex >= 0) {
      throw new Error(
        `Region inheritance cycle: ${[...visiting.slice(cycleIndex), currentId].join(' -> ')}`,
      );
    }

    const pack = byId.get(currentId);
    if (!pack) {
      const child = visiting.at(-1);
      throw new Error(
        child
          ? `Unknown parent region pack "${currentId}" referenced by "${child}"`
          : `Unknown region pack ID: ${currentId}`,
      );
    }

    visiting.push(currentId);
    const parent = pack.inherits ? visit(pack.inherits) : {};
    visiting.pop();

    const parentLanguages = Array.isArray(parent.languages)
      ? (parent.languages as string[])
      : [];
    const merged: Record<string, unknown> = {
      ...parent,
      ...pack,
      inheritance_chain: [
        ...(Array.isArray(parent.inheritance_chain)
          ? (parent.inheritance_chain as string[])
          : []),
        pack.id,
      ],
      outreach_policy: {
        ...((parent.outreach_policy as Record<string, unknown> | undefined) ?? {}),
        ...(pack.outreach_policy ?? {}),
      },
      seo: {
        ...((parent.seo as Record<string, unknown> | undefined) ?? {}),
        ...(pack.seo ?? {}),
      },
    };

    if (pack.languages) {
      merged.languages = stableUnique([...parentLanguages, ...pack.languages]);
    }

    return merged;
  }

  const resolved = visit(id);
  const result = ResolvedRegionPackShapeSchema.safeParse(resolved);
  if (!result.success) {
    throw new Error(
      `Could not resolve required regional field for "${id}": ${result.error.message}`,
    );
  }
  return result.data;
}

export function validateRegionPacks(values: readonly unknown[]): RegionPack[] {
  const packs = values.map((value) => RegionPackSchema.parse(value));
  const byId = packMap(packs);

  for (const pack of packs) {
    if (pack.inherits && !byId.has(pack.inherits)) {
      throw new Error(
        `Unknown parent region pack "${pack.inherits}" referenced by "${pack.id}"`,
      );
    }
  }
  for (const pack of packs) {
    resolveRegionPack(pack.id, packs);
  }
  return packs;
}

export async function loadRegionPacks(
  directory: string,
  fileNames: readonly string[],
): Promise<RegionPack[]> {
  const values = await Promise.all(
    [...fileNames]
      .sort()
      .map(async (fileName) => parse(await readFile(join(directory, fileName), 'utf8'))),
  );
  return validateRegionPacks(values);
}
