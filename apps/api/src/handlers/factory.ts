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
import { renderSite } from '../factory/render.js';
import type { Descriptor } from '../factory/dossier.js';

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
  const region = typeof input.region === 'string' && input.region.trim() !== '' ? input.region.trim() : 'global';
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

  const descriptor = buildDescriptor({ profileUrl, region, template, stylePack, dossier });

  /*
   * Render only when a template was chosen. A refusal is reported rather than
   * thrown: the descriptor is still worth persisting so the operator can see
   * exactly which sections could not be satisfied and supply the missing
   * facts, instead of losing the research done so far.
   */
  const render = template === null ? null : renderSite(descriptor);

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

  const buildStatus =
    render === null
      ? 'descriptor_draft'
      : render.rendered
        ? 'preview_built'
        : 'template_unsatisfied';

  return {
    siteId,
    status: dossier.blocked.length > 0 && buildStatus === 'descriptor_draft'
      ? 'descriptor_draft_with_gaps'
      : buildStatus,
    created: true,
    factCount: dossier.facts.length,
    blocked: dossier.blocked,
    // The fingerprint publishing would promote; absent when nothing rendered.
    buildHash: render?.rendered ? render.hash : undefined,
    renderIssues: render && !render.rendered ? render.issues : undefined,
  };
};

/** How long a preview stays viewable after its last build. */
export const PREVIEW_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function previewExpiry(builtAt: Date, ttlMs = PREVIEW_TTL_MS): Date {
  return new Date(builtAt.getTime() + ttlMs);
}

/**
 * factory.preview — return the immutable build for a stored descriptor.
 *
 * The build is not stored: rendering is deterministic, so re-rendering the
 * persisted descriptor reproduces the same bytes and the same hash. That keeps
 * a single source of truth and makes it impossible for a stored copy to drift
 * from the descriptor it claims to represent.
 *
 * Previews are access-controlled and expiring by design. They are never served
 * publicly, and the markup carries noindex, because publishing is a separate
 * approved step.
 */
export const factoryPreview: CapabilityHandler = async (ctx, input) => {
  const siteId = typeof input.siteId === 'string' ? input.siteId.trim() : '';
  if (siteId === '') {
    throw new CapabilityError(400, 'factory.preview: siteId is required');
  }

  const res = await ctx.q.query(
    `select site_id, descriptor, updated_at from sites where site_id = $1`,
    [siteId],
  );
  const row = res.rows[0];
  if (!row) {
    // RLS scopes this query, so "not visible in this space" and "does not
    // exist" are deliberately indistinguishable to the caller.
    throw new CapabilityError(404, 'factory.preview: site not found');
  }

  const descriptor = row.descriptor as Descriptor;
  const builtAt = row.updated_at ? new Date(String(row.updated_at)) : new Date(0);
  const expiresAt = previewExpiry(builtAt);
  if (expiresAt.getTime() <= Date.now()) {
    return { expired: true, expiresAt: expiresAt.toISOString() };
  }

  const render = renderSite(descriptor);
  if (!render.rendered) {
    return { expired: false, expiresAt: expiresAt.toISOString(), issues: render.issues };
  }

  return {
    expired: false,
    expiresAt: expiresAt.toISOString(),
    html: render.html,
    hash: render.hash,
  };
};
