import { describe, expect, it } from 'vitest';
import {
  CloudflarePagesHosting,
  pagesFileHash,
  pagesHostingFromEnv,
  type PagesFetch,
} from './cloudflare-pages.js';

const CONFIG = {
  accountId: 'acct-1',
  projectName: 'atlas-sites',
  apiToken: 'test-credential',
  baseUrl: 'https://sites.example.com',
  layout: 'path' as const,
};

function ok(result: unknown) {
  return { ok: true, status: 200, json: async () => ({ success: true, result }) };
}

function cfError(status: number, errors: Array<{ code: number; message: string }>) {
  return { ok: false, status, json: async () => ({ success: false, errors }) };
}

/** Records the exchange so the call sequence itself can be asserted. */
function recordingFetch(overrides: Partial<Record<string, unknown>> = {}) {
  const calls: Array<{
    url: string;
    method: string;
    body?: string | FormData;
    auth?: string;
    contentType?: string;
  }> = [];
  const impl: PagesFetch = async (url, init) => {
    calls.push({
      url,
      method: init.method,
      body: init.body,
      auth: init.headers.Authorization,
      contentType: init.headers['Content-Type'],
    });
    if (url.endsWith('/upload-token')) return ok(overrides.token ?? { jwt: 'upload-jwt' });
    if (url.endsWith('/pages/assets/upload')) return ok(overrides.upload ?? {});
    if (url.endsWith('/deployments')) return ok(overrides.deployment ?? { id: 'dep-abc' });
    throw new Error(`unexpected url ${url}`);
  };
  return { impl, calls };
}

describe('pages file hash', () => {
  it('is stable for identical content', () => {
    expect(pagesFileHash('<html></html>')).toBe(pagesFileHash('<html></html>'));
  });

  it('changes when the build changes', () => {
    expect(pagesFileHash('<html>a</html>')).not.toBe(pagesFileHash('<html>b</html>'));
  });

  it('is the 32-character digest Pages expects', () => {
    expect(pagesFileHash('<html></html>')).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('publishing to Pages', () => {
  const target = {
    slug: 'acme-plumbing-1a2b3c4d',
    html: '<html>Acme</html>',
    buildHash: 'a'.repeat(64),
    version: 1,
    alsoServe: [],
  };

  it('uploads the build and creates a deployment at the site path', async () => {
    const { impl, calls } = recordingFetch();
    const result = await new CloudflarePagesHosting(CONFIG, impl).publish(target);

    expect(calls.map((c) => c.url.split('/').pop())).toEqual([
      'upload-token',
      'upload',
      'deployments',
    ]);
    /*
     * The deployment is multipart with the manifest as a form field. This
     * previously asserted a JSON body — the same wrong shape the adapter sent —
     * so the suite passed while production was refused with "a manifest field
     * was expected in the request body but was not provided".
     */
    const body = calls[2].body;
    expect(body).toBeInstanceOf(FormData);
    const manifest = JSON.parse(String((body as FormData).get('manifest'))) as Record<string, string>;
    expect(Object.keys(manifest)).toEqual(['/acme-plumbing-1a2b3c4d/index.html']);
    expect(result.url).toBe('https://sites.example.com/acme-plumbing-1a2b3c4d');
    expect(result.providerRef).toBe('dep-abc');
  });

  /**
   * A Pages deployment is a whole-site snapshot, so a manifest carrying only
   * the promoted site deletes every other one. That happened in production:
   * publishing a second fixture left the first answering 404 while its
   * deployment row still read `live`.
   */
  it('keeps every already-live site in the deployment', async () => {
    const { impl, calls } = recordingFetch();
    await new CloudflarePagesHosting(CONFIG, impl).publish({
      ...target,
      alsoServe: [
        { slug: 'bravo-plumbing-2b3c4d5e', html: '<html>Bravo</html>' },
        { slug: 'charlie-roofing-3c4d5e6f', html: '<html>Charlie</html>' },
      ],
    });

    const manifest = JSON.parse(String((calls[2].body as FormData).get('manifest'))) as Record<string, string>;
    expect(Object.keys(manifest).sort()).toEqual([
      '/acme-plumbing-1a2b3c4d/index.html',
      '/bravo-plumbing-2b3c4d5e/index.html',
      '/charlie-roofing-3c4d5e6f/index.html',
    ]);

    // Every file is uploaded, or the manifest would reference bytes Pages does
    // not have.
    const uploaded = JSON.parse(String(calls[1].body)) as Array<{ key: string; value: string }>;
    expect(uploaded).toHaveLength(3);
    expect(uploaded.map((u) => Buffer.from(u.value, 'base64').toString('utf8')).sort()).toEqual([
      '<html>Acme</html>',
      '<html>Bravo</html>',
      '<html>Charlie</html>',
    ]);
  });

  /** The promoted build wins if a sibling somehow carries the same slug. */
  it('promotes the new build when a sibling repeats its slug', async () => {
    const { impl, calls } = recordingFetch();
    await new CloudflarePagesHosting(CONFIG, impl).publish({
      ...target,
      alsoServe: [{ slug: target.slug, html: '<html>stale</html>' }],
    });

    const uploaded = JSON.parse(String(calls[1].body)) as Array<{ value: string }>;
    expect(uploaded).toHaveLength(1);
    expect(Buffer.from(uploaded[0].value, 'base64').toString('utf8')).toBe('<html>Acme</html>');
  });

  /**
   * fetch generates the multipart boundary. Setting Content-Type by hand
   * produces a body Cloudflare's form parser cannot read, which is the other
   * half of the defect this test exists to prevent.
   */
  it('lets fetch set the multipart content type on the deployment', async () => {
    const { impl, calls } = recordingFetch();
    await new CloudflarePagesHosting(CONFIG, impl).publish(target);

    expect(calls[2].contentType).toBeUndefined();
    expect(calls[2].auth).toBe('Bearer test-credential');
  });

  /** The upload step uses the short-lived token, not the account credential. */
  it('uploads with the issued token rather than the account credential', async () => {
    const { impl, calls } = recordingFetch();
    await new CloudflarePagesHosting(CONFIG, impl).publish(target);

    expect(calls[0].auth).toContain('test-credential');
    expect(calls[1].auth).toContain('upload-jwt');
    expect(calls[1].auth).not.toContain('test-credential');
  });

  it('sends the build base64-encoded so markup cannot corrupt the envelope', async () => {
    const { impl, calls } = recordingFetch();
    await new CloudflarePagesHosting(CONFIG, impl).publish(target);

    const body = JSON.parse(String(calls[1].body)) as Array<{ value: string; base64: boolean }>;
    expect(body[0].base64).toBe(true);
    expect(Buffer.from(body[0].value, 'base64').toString('utf8')).toBe(target.html);
  });

  it('derives a subdomain address when configured for it', async () => {
    const { impl } = recordingFetch();
    const result = await new CloudflarePagesHosting(
      { ...CONFIG, layout: 'subdomain' },
      impl,
    ).publish(target);
    expect(result.url).toBe('https://acme-plumbing-1a2b3c4d.sites.example.com');
  });

  /** A failure must be legible; a bare status hides what to fix. */
  it("surfaces Cloudflare's own error text", async () => {
    const impl: PagesFetch = async () => cfError(403, [{ code: 10000, message: 'Authentication error' }]);
    await expect(new CloudflarePagesHosting(CONFIG, impl).publish(target)).rejects.toThrow(
      /10000: Authentication error/,
    );
  });

  it('names which step failed', async () => {
    const impl: PagesFetch = async (url) =>
      url.endsWith('/deployments')
        ? cfError(500, [{ code: 1, message: 'boom' }])
        : ok({ jwt: 'upload-jwt' });
    await expect(new CloudflarePagesHosting(CONFIG, impl).publish(target)).rejects.toThrow(
      /creating the Pages deployment/,
    );
  });

  it('rejects an upload-token response carrying no token', async () => {
    const impl: PagesFetch = async () => ok({});
    await expect(new CloudflarePagesHosting(CONFIG, impl).publish(target)).rejects.toThrow(
      /no token/,
    );
  });

  it('does not create a deployment when the upload fails', async () => {
    const { calls } = recordingFetch();
    const impl: PagesFetch = async (url, init) => {
      calls.push({ url, method: init.method });
      if (url.endsWith('/upload-token')) return ok({ jwt: 'upload-jwt' });
      return cfError(413, [{ code: 2, message: 'too large' }]);
    };
    await expect(new CloudflarePagesHosting(CONFIG, impl).publish(target)).rejects.toThrow();
    expect(calls.some((c) => c.url.endsWith('/deployments'))).toBe(false);
  });
});

describe('configuration from the environment', () => {
  const full = {
    CLOUDFLARE_API_TOKEN: 'tok',
    CLOUDFLARE_ACCOUNT_ID: 'acct',
    CLOUDFLARE_PAGES_PROJECT: 'atlas-sites',
    ATLAS_SITES_BASE_URL: 'https://sites.example.com',
  };

  it('builds an adapter when every value is present', () => {
    expect(pagesHostingFromEnv(full)).toBeInstanceOf(CloudflarePagesHosting);
  });

  /**
   * A half-configured publisher would fail mid-publish after a deployment row
   * already existed, leaving history claiming something is public that is not.
   */
  it.each(Object.keys(full))('returns null when %s is missing', (key) => {
    const partial = { ...full };
    delete (partial as Record<string, string | undefined>)[key];
    expect(pagesHostingFromEnv(partial)).toBeNull();
  });

  it('treats a blank credential as unconfigured', () => {
    expect(pagesHostingFromEnv({ ...full, CLOUDFLARE_API_TOKEN: '   ' })).toBeNull();
  });

  it('defaults to the path layout unless subdomain is chosen', () => {
    const adapter = pagesHostingFromEnv({ ...full, ATLAS_SITES_LAYOUT: 'subdomain' });
    expect(adapter).toBeInstanceOf(CloudflarePagesHosting);
  });
});
