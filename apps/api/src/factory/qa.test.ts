/**
 * Build QA (docs/specs/p2/website-factory.md).
 *
 * Acceptance: "Required accessibility, responsive, link, structured-data,
 * privacy, security, and performance checks pass before approval."
 *
 * Every blocking check is tested twice: once against the real render, which
 * must pass it, and once against that same render with one thing broken, which
 * must fail it and nothing else. A check that no mutation can fail is
 * decoration, and a check that fails on an unrelated mutation is noise.
 */
import { describe, expect, it } from 'vitest';
import { buildDescriptor, buildDossier } from './dossier.js';
import { renderSite } from './render.js';
import {
  MIN_CONTRAST_RATIO,
  PAGE_WEIGHT_BUDGET_BYTES,
  PAGE_WEIGHT_LIMIT_BYTES,
  contrastRatio,
  qaForDescriptor,
  runQa,
  type QaReport,
} from './qa.js';

const SRC = 'https://maps.example/acme';
const fact = (field: string, value: string) => ({ field, value, sourceUrl: SRC });

function descriptor() {
  return buildDescriptor({
    profileUrl: SRC,
    region: 'global',
    template: 'trades-1',
    stylePack: null,
    dossier: buildDossier([
      fact('businessName', 'Acme Plumbing'),
      fact('phone', '555-0100'),
      fact('hours', 'Mon-Fri 9-5'),
      fact('email', 'hello@acme.example'),
    ]),
  });
}

function goodBuild(): { html: string; tokens: Readonly<Record<string, string>> } {
  const render = renderSite(descriptor());
  if (!render.rendered) throw new Error('fixture must render');
  return { html: render.html, tokens: render.tokens };
}

/** Run QA over the real render with one substitution applied to the markup. */
function withMutation(
  mutate: (html: string) => string,
  tokens?: Record<string, string>,
): QaReport {
  const build = goodBuild();
  return runQa({
    html: mutate(build.html),
    descriptor: descriptor(),
    tokens: tokens ?? build.tokens,
  });
}

function failedIds(report: QaReport): string[] {
  return report.blocking.map((c) => c.id);
}

describe('a real build', () => {
  it('passes every blocking check', () => {
    const build = goodBuild();
    const report = runQa({ html: build.html, descriptor: descriptor(), tokens: build.tokens });
    expect(failedIds(report)).toEqual([]);
    expect(report.passed).toBe(true);
  });

  it('raises no advisories either', () => {
    const build = goodBuild();
    const report = runQa({ html: build.html, descriptor: descriptor(), tokens: build.tokens });
    expect(report.advisories).toEqual([]);
  });

  /** Every category named in the acceptance test must actually be exercised. */
  it('covers all seven required categories', () => {
    const build = goodBuild();
    const report = runQa({ html: build.html, descriptor: descriptor(), tokens: build.tokens });
    expect([...new Set(report.checks.map((c) => c.category))].sort()).toEqual([
      'accessibility',
      'link',
      'performance',
      'privacy',
      'responsive',
      'security',
      'structured-data',
    ]);
  });

  /**
   * Pinned so the count quoted in `docs/control/CURRENT_STATE.md` cannot go
   * stale, and so adding or dropping a required check is a deliberate edit.
   */
  it('runs twenty-eight checks, one of them advisory', () => {
    const build = goodBuild();
    const report = runQa({ html: build.html, descriptor: descriptor(), tokens: build.tokens });
    expect(report.checks).toHaveLength(28);
    expect(report.checks.filter((c) => c.severity === 'advisory')).toHaveLength(1);
  });

  /** Checks read only the bytes and the descriptor, so the verdict is stable. */
  it('produces the same verdict for the same build', () => {
    const build = goodBuild();
    const a = runQa({ html: build.html, descriptor: descriptor(), tokens: build.tokens });
    const b = runQa({ html: build.html, descriptor: descriptor(), tokens: build.tokens });
    expect(a).toEqual(b);
  });
});

describe('accessibility checks', () => {
  it('fails when the document declares no language', () => {
    const report = withMutation((h) => h.replace('<html lang="en">', '<html>'));
    expect(failedIds(report)).toEqual(['accessibility.lang']);
  });

  it('fails on an empty title', () => {
    const report = withMutation((h) => h.replace(/<title>[^<]*<\/title>/, '<title></title>'));
    expect(failedIds(report)).toEqual(['accessibility.title']);
  });

  it('fails when a second top-level heading appears', () => {
    const report = withMutation((h) => h.replace('</main>', '<h1>Also us</h1>\n    </main>'));
    expect(failedIds(report)).toEqual(['accessibility.single-h1']);
  });

  it('fails when the only top-level heading is removed', () => {
    const report = withMutation((h) => h.replace(/<h1[^>]*>/, '<p>').replace('</h1>', '</p>'));
    expect(failedIds(report)).toContain('accessibility.single-h1');
  });

  it('names a section that lost its heading', () => {
    const report = withMutation((h) =>
      h.replace(/<h2 id="contact-heading">[^<]*<\/h2>\n/, ''),
    );
    expect(failedIds(report)).toEqual(['accessibility.section-headings']);
    expect(report.blocking[0].detail).toContain('contact');
  });

  it('fails without a main landmark', () => {
    const report = withMutation((h) => h.replace('<main ', '<div ').replace('</main>', '</div>'));
    expect(failedIds(report)).toEqual(['accessibility.landmark']);
  });

  it('fails on an image with no alt text', () => {
    const report = withMutation((h) => h.replace('</main>', '<img src="/logo.png">\n    </main>'));
    expect(failedIds(report)).toEqual(['accessibility.image-alt']);
  });

  it('accepts an image that declares alt text', () => {
    const report = withMutation((h) =>
      h.replace('</main>', '<img src="/logo.png" alt="Acme">\n    </main>'),
    );
    expect(failedIds(report)).toEqual([]);
  });

  it('fails on a positive tabindex', () => {
    const report = withMutation((h) => h.replace('<footer ', '<footer tabindex="3" '));
    expect(failedIds(report)).toEqual(['accessibility.tab-order']);
  });

  it('fails on a link with no discernible text', () => {
    const report = withMutation((h) =>
      h.replace('</main>', '<a href="https://x.example/" rel="noopener"></a>\n    </main>'),
    );
    expect(failedIds(report)).toEqual(['accessibility.link-text']);
  });

  /** Template tokens are ours to choose, so poor contrast is a build defect. */
  it('fails when the template text token cannot be read on its surface', () => {
    const report = withMutation(
      (h) => h,
      { accent: '#1f6feb', surface: '#ffffff', text: '#e8e8e8' },
    );
    expect(failedIds(report)).toEqual(['accessibility.contrast']);
  });

  it('fails when the accent used for source links is too faint', () => {
    const report = withMutation(
      (h) => h,
      { accent: '#9ad0ff', surface: '#ffffff', text: '#101418' },
    );
    expect(failedIds(report)).toEqual(['accessibility.contrast']);
  });

  it('computes a known contrast ratio', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    expect(contrastRatio('rebeccapurple', '#ffffff')).toBeNull();
  });

  it('shipped templates meet the contrast floor', () => {
    const build = goodBuild();
    const ratio = contrastRatio(build.tokens.accent, build.tokens.surface);
    expect(ratio).not.toBeNull();
    expect(ratio ?? 0).toBeGreaterThanOrEqual(MIN_CONTRAST_RATIO);
  });
});

describe('responsive checks', () => {
  it('fails without a device-width viewport', () => {
    const report = withMutation((h) =>
      h.replace(/<meta name="viewport"[^>]*>/, '<meta name="viewport" content="width=1024">'),
    );
    expect(failedIds(report)).toEqual(['responsive.viewport']);
  });

  it('fails when the viewport meta is missing entirely', () => {
    const report = withMutation((h) => h.replace(/<meta name="viewport"[^>]*>\n/, ''));
    expect(failedIds(report)).toEqual(['responsive.viewport']);
  });

  it('fails when pinch zoom is disabled', () => {
    const report = withMutation((h) =>
      h.replace(
        /<meta name="viewport"[^>]*>/,
        '<meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">',
      ),
    );
    expect(failedIds(report)).toEqual(['responsive.zoom']);
  });

  it('fails when zoom is capped below 2x', () => {
    const report = withMutation((h) =>
      h.replace(
        /<meta name="viewport"[^>]*>/,
        '<meta name="viewport" content="width=device-width, maximum-scale=1.0">',
      ),
    );
    expect(failedIds(report)).toEqual(['responsive.zoom']);
  });

  it('fails on a fixed pixel width that would overflow a phone', () => {
    const report = withMutation((h) =>
      h.replace('      main {', '      main { width: 960px;'),
    );
    expect(failedIds(report)).toEqual(['responsive.fluid-width']);
    expect(report.blocking[0].detail).toContain('960px');
  });
});

describe('link checks', () => {
  it('fails on a placeholder href', () => {
    const report = withMutation((h) =>
      h.replace('</main>', '<a href="#">Read more</a>\n    </main>'),
    );
    expect(failedIds(report)).toEqual(['link.no-placeholder']);
  });

  it('fails on an in-page link with no target', () => {
    const report = withMutation((h) =>
      h.replace('</main>', '<a href="#nowhere">Jump</a>\n    </main>'),
    );
    expect(failedIds(report)).toEqual(['link.fragments-resolve']);
    expect(report.blocking[0].detail).toContain('#nowhere');
  });

  it('accepts an in-page link whose target exists', () => {
    const report = withMutation((h) =>
      h.replace('</main>', '<a href="#contact">Contact us</a>\n    </main>'),
    );
    expect(failedIds(report)).toEqual([]);
  });

  /** A plaintext link out of a page served over TLS is a security finding. */
  it('fails on an http source link', () => {
    const insecure = buildDescriptor({
      profileUrl: SRC,
      region: 'global',
      template: 'trades-1',
      stylePack: null,
      dossier: buildDossier([
        { field: 'businessName', value: 'Acme Plumbing', sourceUrl: 'http://maps.example/acme' },
        fact('phone', '555-0100'),
        fact('hours', 'Mon-Fri 9-5'),
      ]),
    });
    const { report } = qaForDescriptor(insecure);
    expect(report).not.toBeNull();
    expect(failedIds(report as QaReport)).toEqual(['link.scheme']);
  });

  it('fails on an off-site link without rel=noopener', () => {
    const report = withMutation((h) =>
      h.replace('</main>', '<a href="https://x.example/">Elsewhere</a>\n    </main>'),
    );
    expect(failedIds(report)).toEqual(['link.noopener']);
  });
});

describe('structured-data checks', () => {
  it('fails when the JSON-LD block is missing', () => {
    const report = withMutation((h) => h.replace(/<script[\s\S]*?<\/script>\n/, ''));
    expect(failedIds(report)).toContain('structured-data.present');
  });

  it('fails when the JSON-LD does not parse', () => {
    const report = withMutation((h) =>
      h.replace(/(<script type="application\/ld\+json">)[^<]*/, '$1{not json'),
    );
    expect(failedIds(report)).toContain('structured-data.present');
  });

  it('fails when the structured name is not the sourced business name', () => {
    const report = withMutation((h) => h.replace('"Acme Plumbing"', '"Acme Plumbing Ltd"'));
    expect(failedIds(report)).toContain('structured-data.identity');
  });

  /** Structured data must restate sourced facts, never add claims of its own. */
  it('fails on a structured-data value with no fact behind it', () => {
    const report = withMutation((h) =>
      h.replace(
        '"@type":"LocalBusiness"',
        '"@type":"LocalBusiness","priceRange":"$$$"',
      ),
    );
    expect(failedIds(report)).toEqual(['structured-data.sourced']);
    expect(report.blocking[0].detail).toContain('priceRange');
  });

  it('restates the facts it was given', () => {
    const build = goodBuild();
    const block = /<script type="application\/ld\+json">([^<]*)<\/script>/.exec(build.html);
    expect(block).not.toBeNull();
    expect(JSON.parse(block?.[1] ?? '{}')).toEqual({
      '@context': 'https://schema.org',
      '@type': 'LocalBusiness',
      email: 'hello@acme.example',
      name: 'Acme Plumbing',
      openingHours: 'Mon-Fri 9-5',
      telephone: '555-0100',
    });
  });
});

describe('privacy checks', () => {
  it('fails when a third-party resource is loaded', () => {
    const report = withMutation((h) =>
      h.replace('</head>', '<link rel="stylesheet" href="https://cdn.example/x.css">\n  </head>'),
    );
    expect(failedIds(report)).toContain('privacy.no-third-party-resources');
  });

  it('fails when the privacy notice is dropped', () => {
    const report = withMutation((h) => h.replace(' data-privacy-notice', ''));
    expect(failedIds(report)).toEqual(['privacy.notice']);
  });
});

describe('security checks', () => {
  it('fails when the build contains executable script', () => {
    const report = withMutation((h) =>
      h.replace('</main>', '<script>alert(1)</script>\n    </main>'),
    );
    expect(failedIds(report)).toContain('security.no-executable-script');
  });

  it('fails on an inline event handler', () => {
    const report = withMutation((h) => h.replace('<footer ', '<footer onclick="x()" '));
    expect(failedIds(report)).toEqual(['security.no-inline-handlers']);
  });

  it('fails on a javascript: URL', () => {
    const report = withMutation((h) =>
      h.replace('</main>', '<a href="javascript:x()" rel="noopener">Go</a>\n    </main>'),
    );
    expect(failedIds(report)).toContain('security.no-javascript-urls');
  });

  it('fails when the content security policy is removed', () => {
    const report = withMutation((h) => h.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>\n/, ''));
    expect(failedIds(report)).toEqual(['security.csp']);
  });

  /** A JSON-LD block is data the browser never executes. */
  it('does not treat the structured-data block as script', () => {
    const build = goodBuild();
    expect(build.html).toContain('application/ld+json');
    const report = runQa({ html: build.html, descriptor: descriptor(), tokens: build.tokens });
    expect(failedIds(report)).not.toContain('security.no-executable-script');
  });
});

describe('performance checks', () => {
  it('fails a page over the hard weight limit', () => {
    const report = withMutation((h) =>
      h.replace('</main>', `<p>${'x'.repeat(PAGE_WEIGHT_LIMIT_BYTES)}</p>\n    </main>`),
    );
    expect(failedIds(report)).toContain('performance.page-weight');
  });

  it('fails on a render-blocking external resource', () => {
    const report = withMutation((h) =>
      h.replace('</head>', '<link rel="stylesheet" href="/theme.css">\n  </head>'),
    );
    expect(failedIds(report)).toContain('performance.render-blocking');
  });

  /** Over budget is worth saying; it is not a reason to refuse a publish. */
  it('reports a heavy page as an advisory without blocking it', () => {
    const report = withMutation((h) =>
      h.replace('</main>', `<p>${'x'.repeat(PAGE_WEIGHT_BUDGET_BYTES)}</p>\n    </main>`),
    );
    expect(report.advisories.map((c) => c.id)).toEqual(['performance.page-weight-budget']);
    expect(report.passed).toBe(true);
  });
});

describe('qaForDescriptor', () => {
  it('reports no failures for a build that passes', () => {
    const outcome = qaForDescriptor(descriptor());
    expect(outcome.failures).toEqual([]);
    expect(outcome.report?.passed).toBe(true);
  });

  /**
   * A descriptor that will not render has no build to judge. Reporting it as a
   * QA failure would hide the real reason, which the render issues state.
   */
  it('returns no report when the descriptor does not render', () => {
    const thin = buildDescriptor({
      profileUrl: SRC,
      region: 'global',
      template: 'trades-1',
      stylePack: null,
      dossier: buildDossier([fact('businessName', 'Acme Plumbing')]),
    });
    const outcome = qaForDescriptor(thin);
    expect(outcome.report).toBeNull();
    expect(outcome.failures).toEqual([]);
  });
});
