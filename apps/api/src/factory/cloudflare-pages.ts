/**
 * Cloudflare Pages hosting adapter (docs/specs/p2/website-factory.md).
 *
 * Implements the hosting boundary against the Pages direct-upload API. The
 * publish core decides *what* to promote; this only decides where it lands, so
 * swapping providers replaces this file and nothing above it.
 *
 * Pages direct upload is a three-step exchange: ask for an upload token, send
 * the file manifest keyed by content hash, then create a deployment. Files
 * already known to Pages are skipped, so republishing an unchanged build
 * uploads nothing.
 *
 * The last step is multipart/form-data with the manifest as a form field, NOT
 * JSON. Sending it as JSON is accepted by the transport and then rejected by
 * Cloudflare with "a manifest field was expected in the request body but was
 * not provided" — which is what production did, silently, because the adapter's
 * own test asserted the same wrong shape the adapter sent.
 */
import { createHash } from 'node:crypto';
import type { HostingAdapter, PublishTarget, PublishedSite } from './hosting.js';

export interface PagesConfig {
  accountId: string;
  projectName: string;
  apiToken: string;
  /** Public base the project serves from, used to derive the site address. */
  baseUrl: string;
  layout: 'path' | 'subdomain';
}

export type PagesFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string | FormData },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/**
 * Pages identifies files by an MD5 of content plus extension. That is the
 * provider's contract, not a security choice — the build's integrity is
 * established by the sha256 the publish core verified before we got here.
 */
export function pagesFileHash(content: string, extension = 'html'): string {
  return createHash('md5')
    .update(Buffer.from(content, 'utf8'))
    .update(extension)
    .digest('hex')
    .slice(0, 32);
}

interface UploadEntry {
  key: string;
  value: string;
  metadata: { contentType: string };
  base64: true;
}

/** Read a JSON envelope, surfacing Cloudflare's own error text when it fails. */
async function cfJson(
  res: { ok: boolean; status: number; json: () => Promise<unknown> },
  context: string,
): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new Error(`${context}: Cloudflare returned status ${res.status} with an unreadable body`);
  }
  const envelope = (body ?? {}) as { success?: boolean; result?: unknown; errors?: unknown[] };
  if (!res.ok || envelope.success === false) {
    const detail = Array.isArray(envelope.errors)
      ? envelope.errors
          .map((e) => {
            const err = (e ?? {}) as { code?: unknown; message?: unknown };
            return `${String(err.code ?? '?')}: ${String(err.message ?? 'unknown')}`;
          })
          .join('; ')
      : `status ${res.status}`;
    throw new Error(`${context}: ${detail}`);
  }
  return (envelope.result ?? {}) as Record<string, unknown>;
}

export class CloudflarePagesHosting implements HostingAdapter {
  readonly name = 'cloudflare-pages';

  constructor(
    private readonly config: PagesConfig,
    private readonly fetchImpl: PagesFetch = (url, init) => fetch(url, init),
  ) {}

  private get base(): string {
    return `https://api.cloudflare.com/client/v4/accounts/${this.config.accountId}/pages/projects/${this.config.projectName}`;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.apiToken}`,
      'Content-Type': 'application/json',
    };
  }

  async publish(target: PublishTarget): Promise<PublishedSite> {
    /*
     * A Pages deployment is a complete snapshot of the project, not a patch.
     * A manifest carrying only the site being promoted therefore deletes every
     * other one — which is exactly what happened before this took `alsoServe`:
     * publishing a second site left the first answering 404 while its
     * deployment row still read `live`.
     *
     * So every live site goes into every deployment. Duplicate slugs collapse
     * to the promoted build, because that is the one being approved now.
     */
    const files = new Map<string, string>();
    for (const site of target.alsoServe) files.set(site.slug, site.html);
    files.set(target.slug, target.html);

    const entries: UploadEntry[] = [];
    const manifest: Record<string, string> = {};
    for (const [slug, html] of [...files].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      const fileKey = pagesFileHash(html);
      manifest[`/${slug}/index.html`] = fileKey;
      entries.push({
        key: fileKey,
        value: Buffer.from(html, 'utf8').toString('base64'),
        metadata: { contentType: 'text/html' },
        base64: true,
      });
    }

    const tokenResult = await cfJson(
      await this.fetchImpl(`${this.base}/upload-token`, {
        method: 'GET',
        headers: this.headers(),
      }),
      'requesting a Pages upload token',
    );
    const jwt = String(tokenResult.jwt ?? '');
    if (jwt === '') throw new Error('Pages upload token response contained no token');

    await cfJson(
      await this.fetchImpl('https://api.cloudflare.com/client/v4/pages/assets/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(entries),
      }),
      'uploading the build',
    );

    /*
     * multipart/form-data, and the Content-Type header is deliberately omitted:
     * fetch generates it with the boundary, and setting it by hand produces a
     * body Cloudflare's form parser cannot read.
     */
    const form = new FormData();
    form.append('manifest', JSON.stringify(manifest));

    const deployment = await cfJson(
      await this.fetchImpl(`${this.base}/deployments`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.config.apiToken}` },
        body: form,
      }),
      'creating the Pages deployment',
    );

    return {
      url: siteAddress(this.config.baseUrl, target.slug, this.config.layout),
      providerRef: deployment.id === undefined ? null : String(deployment.id),
    };
  }

  /**
   * Deploy an empty manifest, which is how Pages expresses "serve nothing".
   *
   * A deployment is a whole-site snapshot, so an empty one withdraws
   * everything. This is only reached when the last live site is withdrawn;
   * while any remain, they are republished as the snapshot instead.
   */
  async withdrawAll(): Promise<void> {
    const form = new FormData();
    form.append('manifest', JSON.stringify({}));

    await cfJson(
      await this.fetchImpl(`${this.base}/deployments`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.config.apiToken}` },
        body: form,
      }),
      'withdrawing every published site',
    );
  }
}

/** Kept local so the adapter has no import cycle with the boundary module. */
function siteAddress(baseUrl: string, slug: string, layout: 'path' | 'subdomain'): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  if (layout === 'subdomain') {
    return `https://${slug}.${trimmed.replace(/^https?:\/\//, '')}`;
  }
  return `${trimmed}/${slug}`;
}

/**
 * Build the adapter when the environment supplies a credential.
 *
 * Returns null rather than a half-configured adapter: a partially configured
 * publisher that failed at upload time would already have recorded a
 * deployment, and the history would then claim something is public that never
 * was.
 */
export function pagesHostingFromEnv(
  source: Record<string, string | undefined>,
): CloudflarePagesHosting | null {
  const apiToken = source.CLOUDFLARE_API_TOKEN?.trim();
  const accountId = source.CLOUDFLARE_ACCOUNT_ID?.trim();
  const projectName = source.CLOUDFLARE_PAGES_PROJECT?.trim();
  const baseUrl = source.ATLAS_SITES_BASE_URL?.trim();
  if (!apiToken || !accountId || !projectName || !baseUrl) return null;

  const layout = source.ATLAS_SITES_LAYOUT?.trim() === 'subdomain' ? 'subdomain' : 'path';
  return new CloudflarePagesHosting({ accountId, projectName, apiToken, baseUrl, layout });
}
