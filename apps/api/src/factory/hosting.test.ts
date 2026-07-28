import { describe, expect, it } from 'vitest';
import { UnconfiguredHosting, publicUrl, siteSlug } from './hosting.js';

describe('site slug', () => {
  it('derives a readable slug from the business name', () => {
    expect(siteSlug('Acme Plumbing', '99999999-8888-7777-6666-555555555555')).toBe(
      'acme-plumbing-99999999',
    );
  });

  /**
   * Two businesses may share a name. Without the id suffix one tenant's
   * publish would overwrite another's at the same address.
   */
  it('keeps identical names apart', () => {
    const a = siteSlug('Acme Plumbing', '11111111-2222-3333-4444-555555555555');
    const b = siteSlug('Acme Plumbing', '99999999-8888-7777-6666-555555555555');
    expect(a).not.toBe(b);
  });

  it('is stable for the same site across versions', () => {
    const id = '99999999-8888-7777-6666-555555555555';
    expect(siteSlug('Acme Plumbing', id)).toBe(siteSlug('Acme Plumbing', id));
  });

  it('strips punctuation and collapses separators', () => {
    expect(siteSlug("Bob's Café & Grill!!", '11111111-2222-3333-4444-555555555555')).toBe(
      'bob-s-caf-grill-11111111',
    );
  });

  it('still yields an addressable slug when the name has nothing usable', () => {
    expect(siteSlug('!!!', '11111111-2222-3333-4444-555555555555')).toBe('site-11111111');
  });

  it('bounds the length so an address cannot be unwieldy', () => {
    const slug = siteSlug('A'.repeat(200), '11111111-2222-3333-4444-555555555555');
    expect(slug.length).toBeLessThanOrEqual(49);
  });
});

describe('public url', () => {
  it('builds a path layout', () => {
    expect(publicUrl('https://sites.andtronai.com', 'acme-123', 'path')).toBe(
      'https://sites.andtronai.com/acme-123',
    );
  });

  it('builds a subdomain layout', () => {
    expect(publicUrl('https://sites.andtronai.com', 'acme-123', 'subdomain')).toBe(
      'https://acme-123.sites.andtronai.com',
    );
  });

  it('tolerates a trailing slash on the base', () => {
    expect(publicUrl('https://sites.andtronai.com/', 'acme-123', 'path')).toBe(
      'https://sites.andtronai.com/acme-123',
    );
  });
});

describe('unconfigured hosting', () => {
  /**
   * Refusing beats returning a plausible URL: an unreachable address in
   * deployment history would make the history misreport what is public.
   */
  it('refuses rather than returning an address that does not serve', async () => {
    await expect(new UnconfiguredHosting().publish()).rejects.toThrow(/not served|no hosting/i);
  });
});
