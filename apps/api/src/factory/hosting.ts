/**
 * Hosting adapter boundary (docs/specs/p2/website-factory.md).
 *
 * The specification treats hosting as an adapter, so publishing decides *what*
 * to promote and an adapter decides *where* it lands. Everything above this
 * line — verification, versioning, rollback — is provider-agnostic.
 *
 * Nothing here performs a deploy. The adapter is injected, so the publish path
 * is testable without a network and a provider swap touches one implementation
 * rather than the pipeline.
 */

/** One site's approved build, as it must be served. */
export interface SiteFile {
  slug: string;
  html: string;
}

export interface PublishTarget {
  /** Stable per-site key, used as the project or path segment. */
  slug: string;
  /** The exact build being promoted. */
  html: string;
  buildHash: string;
  version: number;
  /**
   * Every other site that must remain served after this publish.
   *
   * Providers that deploy a whole-site snapshot — Cloudflare Pages among them —
   * replace everything each time, so a deployment carrying one site silently
   * takes every other one offline. That happened: publishing a second fixture
   * left the first answering 404 while its deployment row still read `live`.
   *
   * The caller supplies the set because only it can know which deployments are
   * live and re-derive their approved bytes. The adapter stays a boundary that
   * decides where things land, not what is live.
   */
  alsoServe: readonly SiteFile[];
}

export interface PublishedSite {
  /** Where the build is now reachable. */
  url: string;
  /** Provider's own identifier, for later rollback or inspection. */
  providerRef: string | null;
}

export interface HostingAdapter {
  readonly name: string;
  publish(target: PublishTarget): Promise<PublishedSite>;
  /**
   * Serve nothing at all.
   *
   * Withdrawing the last live site cannot be expressed as a publish, because
   * there is nothing left to publish. Providers that deploy a whole-site
   * snapshot need an explicit empty one.
   */
  withdrawAll(): Promise<void>;
}

/**
 * The adapter used when no hosting provider is configured.
 *
 * It refuses rather than pretending. A no-op that returned a plausible URL
 * would put an unreachable address into deployment history, and the history
 * would then misreport what is public — the specific failure the deployment
 * record exists to prevent.
 */
export class UnconfiguredHosting implements HostingAdapter {
  readonly name = 'unconfigured';

  publish(): Promise<PublishedSite> {
    return Promise.reject(
      new Error('no hosting adapter is configured; the build is verified and recorded but not served'),
    );
  }

  withdrawAll(): Promise<void> {
    return Promise.reject(new Error('no hosting adapter is configured; nothing is served to withdraw'));
  }
}

/** Slug for a site's public address. Stable across versions of the same site. */
export function siteSlug(businessName: string, siteId: string): string {
  const base = businessName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  // The id suffix keeps two businesses with the same name from colliding,
  // which would otherwise let one tenant's publish overwrite another's.
  const suffix = siteId.replace(/-/g, '').slice(0, 8);
  return base === '' ? `site-${suffix}` : `${base}-${suffix}`;
}

/**
 * Resolve the public URL for a slug under a configured base.
 *
 * Path and subdomain layouts differ only here, which is why the routing
 * decision never reached the publish logic.
 */
export function publicUrl(baseUrl: string, slug: string, layout: 'path' | 'subdomain'): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  if (layout === 'subdomain') {
    const withoutScheme = trimmed.replace(/^https?:\/\//, '');
    return `https://${slug}.${withoutScheme}`;
  }
  return `${trimmed}/${slug}`;
}
