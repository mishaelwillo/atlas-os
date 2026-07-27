/**
 * factory.* handlers. Implemented now: factory.build_site (dossier →
 * descriptor → draft site). See docs/specs/p2/website-factory.md.
 */
import { CapabilityError, insertAudit, type CapabilityHandler } from '../pipeline.js';
import {
  buildDescriptor,
  buildDossier,
  businessNameFrom,
  type RawFact,
} from '../factory/dossier.js';

/**
 * factory.build_site — turn supplied research facts into a versioned draft
 * descriptor.
 *
 * Research adapters are an "integrate now" item and are not built, so facts
 * are supplied by the caller rather than scraped here. That does not weaken
 * the sourcing rule: every fact still needs a source URL or an explicit
 * owner-provided marker, and unsourced or contradictory ones are recorded as
 * blocked instead of being rendered.
 *
 * No preview is generated: preview hosting is a separate integration, so no
 * previewUrl is returned rather than one that does not resolve.
 */
export const factoryBuildSite: CapabilityHandler = async (ctx, input) => {
  const profileUrl = typeof input.profileUrl === 'string' ? input.profileUrl.trim() : '';
  if (profileUrl === '') {
    throw new CapabilityError(400, 'factory.build_site: profileUrl is required');
  }
  if (ctx.spaceId === null) {
    // sites.space_id is NOT NULL; a site must belong to a tenant.
    throw new CapabilityError(400, 'factory.build_site requires a space (x-atlas-space)');
  }

  const template = typeof input.template === 'string' && input.template.trim() !== '' ? input.template.trim() : null;
  const stylePack = typeof input.stylePack === 'string' && input.stylePack.trim() !== '' ? input.stylePack.trim() : null;
  const rawFacts: RawFact[] = Array.isArray(input.facts) ? (input.facts as RawFact[]) : [];

  const dossier = buildDossier(rawFacts);
  const businessName = businessNameFrom(dossier);

  /*
   * Without a sourced business name there is nothing that can honestly be
   * displayed, so no site is created. Inventing a placeholder would put an
   * unsourced fact on the page, which is the one thing this stage forbids.
   */
  if (businessName === null) {
    return {
      status: 'facts_pending_review',
      created: false,
      note: 'no sourced businessName: supply one with a source URL or mark it owner-provided',
      blocked: dossier.blocked,
      factCount: dossier.facts.length,
    };
  }

  const descriptor = buildDescriptor({ profileUrl, template, stylePack, dossier });

  const res = await ctx.q.query(
    `insert into sites (space_id, business_name, status, descriptor, template, style_pack, source_profile)
     values ($1, $2, 'draft', $3::jsonb, $4, $5, $6::jsonb)
     returning site_id`,
    [
      ctx.spaceId,
      businessName,
      JSON.stringify(descriptor),
      template,
      stylePack,
      JSON.stringify({ profileUrl, suppliedFacts: rawFacts.length }),
    ],
  );

  const siteId = String(res.rows[0]?.site_id ?? '');
  if (siteId === '') {
    throw new CapabilityError(500, 'factory.build_site: site was not persisted');
  }

  await insertAudit(ctx.q, ctx.spaceId, ctx.auth.actor, 'factory.build_site', siteId, {
    profileUrl,
    facts: dossier.facts.length,
    blocked: dossier.blocked.length,
  });

  return {
    siteId,
    status: dossier.blocked.length > 0 ? 'descriptor_draft_with_gaps' : 'descriptor_draft',
    created: true,
    factCount: dossier.facts.length,
    blocked: dossier.blocked,
  };
};
