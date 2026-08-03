/**
 * Build QA (docs/specs/p2/website-factory.md).
 *
 * Acceptance: "Required accessibility, responsive, link, structured-data,
 * privacy, security, and performance checks pass before approval." The
 * generation state machine's `qa_failed` state is what this produces, and a
 * blocking failure is what stops a build reaching an approved publish.
 *
 * Every check reads the rendered bytes and the descriptor and nothing else —
 * no network, no clock, no headless browser. That is deliberate: the whole
 * factory rests on the same descriptor + template always producing the same
 * bytes, so the verdict on those bytes must be reproducible too. A QA result
 * that could differ between the approval and the publish would defeat the
 * fingerprint check it sits next to.
 *
 * Because it is recomputable, no QA row is stored. Persisting a verdict would
 * create a second source of truth that can drift from the build it claims to
 * describe, exactly as a stored render could drift from its descriptor.
 */
import type { Descriptor } from './dossier.js';
import { renderSite } from './render.js';

export type QaCategory =
  | 'accessibility'
  | 'responsive'
  | 'link'
  | 'structured-data'
  | 'privacy'
  | 'security'
  | 'performance';

/**
 * `blocking` failures stop the build; `advisory` ones are reported and do not.
 * The spec's `qa_result` carries severity because not every finding is a
 * defect — a page nearing its weight budget is worth saying out loud without
 * refusing to publish it.
 */
export type QaSeverity = 'blocking' | 'advisory';

export interface QaCheck {
  /** Stable id; this is what an operator sees and what a refusal names. */
  id: string;
  category: QaCategory;
  severity: QaSeverity;
  passed: boolean;
  /** What was required, and — when failed — what was found instead. */
  detail: string;
}

export interface QaReport {
  /** False when any blocking check failed. Advisories never set this. */
  passed: boolean;
  checks: QaCheck[];
  /** Blocking failures only, in check order. */
  blocking: QaCheck[];
  /** Non-blocking findings, in check order. */
  advisories: QaCheck[];
}

/** Hard ceiling for one page's bytes; above this the build is refused. */
export const PAGE_WEIGHT_LIMIT_BYTES = 150 * 1024;
/** Budget above which the page is reported as heavy but still publishable. */
export const PAGE_WEIGHT_BUDGET_BYTES = 40 * 1024;
/** WCAG AA contrast for body text. */
export const MIN_CONTRAST_RATIO = 4.5;

/** Link schemes a generated page may use. `http:` is absent on purpose. */
const ALLOWED_LINK_SCHEMES = ['https:', 'mailto:', 'tel:'];

function check(
  id: string,
  category: QaCategory,
  passed: boolean,
  detail: string,
  severity: QaSeverity = 'blocking',
): QaCheck {
  return { id, category, severity, passed, detail };
}

function matchAll(html: string, re: RegExp): RegExpMatchArray[] {
  return [...html.matchAll(re)];
}

/** Visible text of a markup fragment, with tags removed. */
function text(fragment: string): string {
  return fragment.replace(/<[^>]*>/g, '').trim();
}

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`, 'i').exec(tag);
  return m ? m[1] : null;
}

/** sRGB relative luminance (WCAG 2.x). */
function luminance(hex: string): number | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const channels = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255);
  const linear = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

export function contrastRatio(a: string, b: string): number | null {
  const la = luminance(a);
  const lb = luminance(b);
  if (la === null || lb === null) return null;
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

function accessibility(html: string, tokens: Record<string, string>): QaCheck[] {
  const lang = /<html[^>]*\slang\s*=\s*"([^"]+)"/i.exec(html);
  const title = /<title>([\s\S]*?)<\/title>/i.exec(html);
  const h1s = matchAll(html, /<h1[^>]*>([\s\S]*?)<\/h1>/gi);
  const mains = matchAll(html, /<main[\s>]/gi);
  const sections = matchAll(html, /<section\b[^>]*>([\s\S]*?)<\/section>/gi);
  // A heading may wrap markup — the business name carries its source link — so
  // the test is that some heading has visible text, not that it is bare text.
  const unheaded = sections
    .filter((s) =>
      matchAll(s[1], /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi).every(
        (h) => text(h[1]) === '',
      ),
    )
    .map((s) => attr(s[0], 'id') ?? '(unnamed)');
  const images = matchAll(html, /<img\b[^>]*>/gi);
  const imagesWithoutAlt = images.filter((i) => attr(i[0], 'alt') === null);
  const positiveTabindex = matchAll(html, /\stabindex\s*=\s*"([^"]*)"/gi).filter(
    (t) => Number(t[1]) > 0,
  );
  const emptyLinks = matchAll(html, /<a\b[^>]*>([\s\S]*?)<\/a>/gi).filter(
    (a) => text(a[1]) === '',
  );

  const ratio = contrastRatio(tokens.text ?? '', tokens.surface ?? '');
  const accentRatio = contrastRatio(tokens.accent ?? '', tokens.surface ?? '');
  const worst =
    ratio === null || accentRatio === null ? null : Math.min(ratio, accentRatio);

  return [
    check(
      'accessibility.lang',
      'accessibility',
      lang !== null && lang[1].trim() !== '',
      'the document declares a language',
    ),
    check(
      'accessibility.title',
      'accessibility',
      title !== null && title[1].trim() !== '',
      'the document has a non-empty title',
    ),
    check(
      'accessibility.single-h1',
      'accessibility',
      h1s.length === 1 && text(h1s[0][1]) !== '',
      `exactly one non-empty top-level heading (found ${h1s.length})`,
    ),
    check(
      'accessibility.section-headings',
      'accessibility',
      unheaded.length === 0,
      unheaded.length === 0
        ? 'every section carries a heading'
        : `sections without a heading: ${unheaded.join(', ')}`,
    ),
    check(
      'accessibility.landmark',
      'accessibility',
      mains.length === 1,
      `exactly one main landmark (found ${mains.length})`,
    ),
    check(
      'accessibility.image-alt',
      'accessibility',
      imagesWithoutAlt.length === 0,
      `every image declares alt text (${imagesWithoutAlt.length} without)`,
    ),
    check(
      'accessibility.tab-order',
      'accessibility',
      positiveTabindex.length === 0,
      `no positive tabindex overrides document order (found ${positiveTabindex.length})`,
    ),
    check(
      'accessibility.link-text',
      'accessibility',
      emptyLinks.length === 0,
      `every link has discernible text (${emptyLinks.length} without)`,
    ),
    check(
      'accessibility.contrast',
      'accessibility',
      worst !== null && worst >= MIN_CONTRAST_RATIO,
      worst === null
        ? 'template text/surface/accent tokens must be six-digit hex colours'
        : `text and accent reach ${MIN_CONTRAST_RATIO}:1 against the surface (worst ${worst.toFixed(2)}:1)`,
    ),
  ];
}

function responsive(html: string): QaCheck[] {
  const viewport = matchAll(html, /<meta\b[^>]*>/gi).find(
    (m) => (attr(m[0], 'name') ?? '').toLowerCase() === 'viewport',
  );
  const content = viewport ? (attr(viewport[0], 'content') ?? '') : '';
  const maxScale = /maximum-scale\s*=\s*([\d.]+)/i.exec(content);
  const zoomBlocked =
    /user-scalable\s*=\s*(no|0)/i.test(content) ||
    (maxScale !== null && Number(maxScale[1]) < 2);

  const style = /<style>([\s\S]*?)<\/style>/i.exec(html)?.[1] ?? '';
  // Any three-or-more-digit fixed width forces a horizontal scrollbar on a
  // narrow viewport, which is the failure this category exists to catch.
  const fixedWidths = matchAll(style, /\bwidth\s*:\s*(\d{3,})px/gi);

  return [
    check(
      'responsive.viewport',
      'responsive',
      viewport !== undefined && /width\s*=\s*device-width/i.test(content),
      'a viewport meta sets width=device-width',
    ),
    check(
      'responsive.zoom',
      'responsive',
      !zoomBlocked,
      'pinch zoom is not disabled or capped below 2x',
    ),
    check(
      'responsive.fluid-width',
      'responsive',
      fixedWidths.length === 0,
      fixedWidths.length === 0
        ? 'no fixed pixel widths that would overflow a narrow viewport'
        : `fixed widths in the stylesheet: ${fixedWidths.map((f) => `${f[1]}px`).join(', ')}`,
    ),
  ];
}

function links(html: string): QaCheck[] {
  const anchors = matchAll(html, /<a\b[^>]*>/gi);
  const hrefs = anchors.map((a) => attr(a[0], 'href') ?? '');
  const ids = new Set(matchAll(html, /\sid\s*=\s*"([^"]*)"/gi).map((m) => m[1]));

  const placeholders = hrefs.filter((h) => h.trim() === '' || h.trim() === '#');
  const fragments = hrefs.filter((h) => h.startsWith('#') && h !== '#');
  const danglingFragments = fragments.filter((h) => !ids.has(h.slice(1)));

  // Only absolute URLs carry a scheme; a root-relative href stays on the site
  // and needs no scheme check.
  const schemeBearing = hrefs.filter((h) => /^[a-z][a-z0-9+.-]*:/i.test(h));
  const badScheme = schemeBearing.filter(
    (h) => !ALLOWED_LINK_SCHEMES.some((s) => h.toLowerCase().startsWith(s)),
  );

  const offSite = anchors.filter((a) => (attr(a[0], 'href') ?? '').toLowerCase().startsWith('https:'));
  const withoutNoopener = offSite.filter((a) => !/noopener/i.test(attr(a[0], 'rel') ?? ''));

  return [
    check(
      'link.no-placeholder',
      'link',
      placeholders.length === 0,
      `no empty or '#' placeholder links (found ${placeholders.length})`,
    ),
    check(
      'link.fragments-resolve',
      'link',
      danglingFragments.length === 0,
      danglingFragments.length === 0
        ? 'every in-page link points at an element that exists'
        : `fragments with no target: ${danglingFragments.join(', ')}`,
    ),
    check(
      'link.scheme',
      'link',
      badScheme.length === 0,
      badScheme.length === 0
        ? `every absolute link uses ${ALLOWED_LINK_SCHEMES.join(', ')}`
        : `disallowed link schemes: ${badScheme.join(', ')}`,
    ),
    check(
      'link.noopener',
      'link',
      withoutNoopener.length === 0,
      `every off-site link carries rel=noopener (${withoutNoopener.length} without)`,
    ),
  ];
}

/**
 * Structured data must be a restatement of sourced facts, never an addition to
 * them. Search engines read it as claims about the business, so an unsourced
 * value here is the same defect as an unsourced value on the page — just
 * harder to see.
 */
function structuredData(html: string, descriptor: Descriptor): QaCheck[] {
  const blocks = matchAll(
    html,
    /<script\b[^>]*type\s*=\s*"application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi,
  );

  if (blocks.length !== 1) {
    return [
      check(
        'structured-data.present',
        'structured-data',
        false,
        `exactly one JSON-LD block (found ${blocks.length})`,
      ),
      check('structured-data.identity', 'structured-data', false, 'not evaluated: no JSON-LD block'),
      check('structured-data.sourced', 'structured-data', false, 'not evaluated: no JSON-LD block'),
    ];
  }

  let parsed: Record<string, unknown> | null;
  try {
    const value: unknown = JSON.parse(blocks[0][1]);
    parsed = value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  } catch {
    parsed = null;
  }

  if (parsed === null) {
    return [
      check('structured-data.present', 'structured-data', false, 'the JSON-LD block parses as a JSON object'),
      check('structured-data.identity', 'structured-data', false, 'not evaluated: JSON-LD did not parse'),
      check('structured-data.sourced', 'structured-data', false, 'not evaluated: JSON-LD did not parse'),
    ];
  }

  const name = descriptor.facts.find((f) => f.field === 'businessName')?.value ?? null;
  const identity =
    String(parsed['@context'] ?? '').replace(/^http:/, 'https:') === 'https://schema.org' &&
    typeof parsed['@type'] === 'string' &&
    parsed['@type'] !== '' &&
    name !== null &&
    parsed.name === name;

  const values = new Set(descriptor.facts.map((f) => f.value));
  const unsourced = Object.entries(parsed)
    .filter(([key]) => !key.startsWith('@'))
    .filter(([, value]) => !(typeof value === 'string' && values.has(value)))
    .map(([key]) => key);

  return [
    check('structured-data.present', 'structured-data', true, 'exactly one JSON-LD block that parses'),
    check(
      'structured-data.identity',
      'structured-data',
      identity,
      'JSON-LD declares schema.org, a type, and the sourced business name',
    ),
    check(
      'structured-data.sourced',
      'structured-data',
      unsourced.length === 0,
      unsourced.length === 0
        ? 'every structured-data value restates a sourced fact'
        : `structured-data values with no sourced fact behind them: ${unsourced.join(', ')}`,
    ),
  ];
}

/** Origins a generated page may load a subresource from: only itself. */
function privacy(html: string): QaCheck[] {
  const resources = [
    ...matchAll(html, /<(?:img|iframe|video|audio|embed|source)\b[^>]*>/gi),
    ...matchAll(html, /<link\b[^>]*>/gi),
    ...matchAll(html, /<script\b[^>]*\ssrc\s*=\s*"[^"]*"[^>]*>/gi),
  ];
  const thirdParty = resources
    .map((r) => attr(r[0], 'src') ?? attr(r[0], 'href') ?? '')
    .filter((u) => /^[a-z][a-z0-9+.-]*:\/\//i.test(u) || u.startsWith('//'));

  const notice = /data-privacy-notice/i.test(html);

  return [
    check(
      'privacy.no-third-party-resources',
      'privacy',
      thirdParty.length === 0,
      thirdParty.length === 0
        ? 'the page loads nothing from a third-party origin'
        : `third-party subresources: ${thirdParty.join(', ')}`,
    ),
    check(
      'privacy.notice',
      'privacy',
      notice,
      'the page carries the region pack privacy notice',
    ),
  ];
}

function security(html: string): QaCheck[] {
  const scripts = matchAll(html, /<script\b([^>]*)>/gi);
  // A JSON-LD block is data the browser never executes; anything else is code.
  const executable = scripts.filter(
    (s) => !/type\s*=\s*"application\/ld\+json"/i.test(s[1]),
  );
  const inlineHandlers = matchAll(html, /\son[a-z]+\s*=\s*"/gi);
  const jsUrls = matchAll(html, /(?:href|src)\s*=\s*"\s*javascript:/gi);
  const csp = matchAll(html, /<meta\b[^>]*>/gi).find(
    (m) => (attr(m[0], 'http-equiv') ?? '').toLowerCase() === 'content-security-policy',
  );

  return [
    check(
      'security.no-executable-script',
      'security',
      executable.length === 0,
      `the build contains no executable script (found ${executable.length})`,
    ),
    check(
      'security.no-inline-handlers',
      'security',
      inlineHandlers.length === 0,
      `no inline event handlers (found ${inlineHandlers.length})`,
    ),
    check(
      'security.no-javascript-urls',
      'security',
      jsUrls.length === 0,
      `no javascript: URLs (found ${jsUrls.length})`,
    ),
    check(
      'security.csp',
      'security',
      csp !== undefined && /default-src/i.test(attr(csp[0], 'content') ?? ''),
      'a content security policy with a default-src is declared',
    ),
  ];
}

function performance(html: string): QaCheck[] {
  const bytes = Buffer.byteLength(html, 'utf8');
  const external = matchAll(html, /<(?:script|link)\b[^>]*>/gi)
    .map((r) => attr(r[0], 'src') ?? attr(r[0], 'href') ?? '')
    .filter((u) => u !== '');

  return [
    check(
      'performance.page-weight',
      'performance',
      bytes <= PAGE_WEIGHT_LIMIT_BYTES,
      `the page is at most ${PAGE_WEIGHT_LIMIT_BYTES} bytes (is ${bytes})`,
    ),
    check(
      'performance.render-blocking',
      'performance',
      external.length === 0,
      external.length === 0
        ? 'nothing external blocks the first render'
        : `render-blocking external resources: ${external.join(', ')}`,
    ),
    check(
      'performance.page-weight-budget',
      'performance',
      bytes <= PAGE_WEIGHT_BUDGET_BYTES,
      `the page is within the ${PAGE_WEIGHT_BUDGET_BYTES}-byte budget (is ${bytes})`,
      'advisory',
    ),
  ];
}

/**
 * Run every required check against one rendered build.
 *
 * Checks are independent and all of them run, so an operator sees every reason
 * at once rather than fixing one and discovering the next.
 */
export function runQa(args: {
  html: string;
  descriptor: Descriptor;
  /** Template tokens, needed for the contrast check. */
  tokens: Readonly<Record<string, string>>;
}): QaReport {
  const checks = [
    ...accessibility(args.html, { ...args.tokens }),
    ...responsive(args.html),
    ...links(args.html),
    ...structuredData(args.html, args.descriptor),
    ...privacy(args.html),
    ...security(args.html),
    ...performance(args.html),
  ];

  const blocking = checks.filter((c) => !c.passed && c.severity === 'blocking');
  const advisories = checks.filter((c) => !c.passed && c.severity === 'advisory');
  return { passed: blocking.length === 0, checks, blocking, advisories };
}

export interface QaOutcome {
  /** Null when the descriptor does not render; there is nothing to check. */
  report: QaReport | null;
  /** Blocking check ids, the form the publish rule consumes. */
  failures: string[];
}

/**
 * Render a descriptor and run QA over the result.
 *
 * A descriptor that will not render is not "QA passed"; it has no build to
 * judge. Callers refuse it on the render issues, and `failures` stays empty so
 * the two refusals never get confused with each other.
 */
export function qaForDescriptor(descriptor: Descriptor): QaOutcome {
  const render = renderSite(descriptor);
  if (!render.rendered) return { report: null, failures: [] };
  const report = runQa({ html: render.html, descriptor, tokens: render.tokens });
  return { report, failures: report.blocking.map((c) => c.id) };
}

/** One-line summary for an audit row or a refusal message. */
export function describeFailures(failures: readonly string[]): string {
  return failures.join(', ');
}
