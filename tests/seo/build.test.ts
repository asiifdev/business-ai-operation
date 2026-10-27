import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'node-html-parser';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { locales, pageUrl, site, type Locale } from '../../src/config/site';
import { plans } from '../../src/content/pricing';
import { en } from '../../src/content/site/en';
import { id } from '../../src/content/site/id';
import { PAGE_SLUGS, type PageSlug } from '../../src/content/site/types';
import { fill } from '../../src/lib/marketing';

/**
 * BR-M16-24: automated SEO / GEO / AEO checks on the BUILT site. Skipped until `pnpm build` has produced dist/client;
 * `pnpm verify` builds first. Everything here is checkable by a machine; ranking and citation are outside our control.
 */
const DIST = 'dist/client';
const built = existsSync(join(DIST, 'index.html'));
const suite = built ? describe : describe.skip;
const content = { en, id } as const;

const fileFor = (locale: Locale, slug: PageSlug) => join(DIST, locale === 'id' ? 'id' : '', slug, 'index.html');
const pages = locales.flatMap((locale) => PAGE_SLUGS.map((slug) => ({ locale, slug, label: `${locale}/${slug || 'home'}` })));
const load = (locale: Locale, slug: PageSlug) => parse(readFileSync(fileFor(locale, slug), 'utf8'));
const meta = (root: ReturnType<typeof parse>, sel: string) => root.querySelector(sel)?.getAttribute('content') ?? root.querySelector(sel)?.getAttribute('href');
const text = (root: ReturnType<typeof parse>) => root.querySelector('main')?.text.replace(/\s+/g, ' ') ?? '';

function targetExists(href: string): boolean {
  const path = href.split('#')[0].split('?')[0];
  if (path === '' || path === '/') return existsSync(join(DIST, 'index.html'));
  const clean = path.replace(/^\//, '').replace(/\/$/, '');
  return existsSync(join(DIST, clean)) && /\.[a-z0-9]+$/.test(clean) ? true : existsSync(join(DIST, clean, 'index.html')) || existsSync(join(DIST, `${clean}.html`));
}
/** Routes served by the app itself (not prerendered files). */
const APP_ROUTES = [/^\/login/, /^\/register/, /^\/app/, /^\/api\//];

suite('every built page', () => {
  it.each(pages.map((p) => [p.label, p] as const))('%s has the on-page SEO essentials', (_l, { locale, slug }) => {
    const root = load(locale, slug);
    const page = content[locale][slug];
    expect(root.querySelectorAll('h1').length, 'exactly one <h1>').toBe(1);
    expect(root.querySelector('html')?.getAttribute('lang')).toBe(locale);
    expect(root.querySelector('title')?.text).toBe(fill(page.title));
    expect(meta(root, 'meta[name="description"]')).toBe(fill(page.description));
    expect(meta(root, 'link[rel="canonical"]')).toBe(pageUrl(locale, slug));
    expect(meta(root, 'meta[name="robots"]') ?? '').not.toMatch(/noindex/);
    expect(meta(root, 'meta[property="og:image"]')).toBe(`${site.url}/og/${locale}.png`);
    expect(meta(root, 'meta[property="og:title"]')).toBe(fill(page.title));
    expect(meta(root, 'meta[name="twitter:card"]')).toBe('summary_large_image');
  });

  it.each(pages.map((p) => [p.label, p] as const))('%s states its direct answer and last-updated date as visible text', (_l, { locale, slug }) => {
    const page = content[locale][slug];
    const t = text(load(locale, slug));
    expect(t).toContain(fill(page.answer));
    expect(t).toContain(page.updated.slice(0, 4));
    expect(load(locale, slug).querySelector(`time[datetime="${page.updated}"]`)).not.toBeNull();
  });

  it.each(pages.map((p) => [p.label, p] as const))('%s has reciprocal hreflang alternates', (_l, { locale, slug }) => {
    const root = load(locale, slug);
    const alts = Object.fromEntries(root.querySelectorAll('link[rel="alternate"][hreflang]').map((l) => [l.getAttribute('hreflang')!, l.getAttribute('href')!]));
    expect(alts.en).toBe(pageUrl('en', slug));
    expect(alts.id).toBe(pageUrl('id', slug));
    expect(alts['x-default']).toBe(pageUrl('en', slug));
    // The alternate page must point back at this page.
    const other: Locale = locale === 'en' ? 'id' : 'en';
    const back = load(other, slug).querySelector(`link[rel="alternate"][hreflang="${locale}"]`)?.getAttribute('href');
    expect(back).toBe(pageUrl(locale, slug));
  });

  it.each(pages.map((p) => [p.label, p] as const))('%s has valid JSON-LD that matches the page and promises no purchasable offer', (_l, { locale, slug }) => {
    const root = load(locale, slug);
    const blocks = root.querySelectorAll('script[type="application/ld+json"]');
    expect(blocks.length).toBeGreaterThan(0);
    const graph = blocks.flatMap((b) => (JSON.parse(b.text) as { '@graph': Record<string, unknown>[] })['@graph']);
    const types = graph.map((n) => n['@type']);
    expect(types).toEqual(expect.arrayContaining(['Organization', 'WebSite', 'WebPage']));
    expect(JSON.stringify(graph)).not.toMatch(/"offers"|"@type":"Offer"/); // BR-M16-26
    const t = text(root);
    const page = content[locale][slug];
    if (slug === 'faq') {
      const faq = graph.find((n) => n['@type'] === 'FAQPage') as { mainEntity: { name: string; acceptedAnswer: { text: string } }[] };
      expect(faq.mainEntity.length).toBe(page.faq!.length);
      for (const q of faq.mainEntity) {
        expect(t, `FAQ question "${q.name}" must also be visible text`).toContain(q.name);
        expect(t).toContain(q.acceptedAnswer.text);
      }
    }
    if (slug !== '') {
      const crumbs = graph.find((n) => n['@type'] === 'BreadcrumbList') as { itemListElement: { position: number; name: string }[] };
      expect(crumbs.itemListElement.at(-1)?.name).toBe(fill(page.h1));
    }
  });

  it.each(pages.map((p) => [p.label, p] as const))('%s has working internal links and no third-party resources', (_l, { locale, slug }) => {
    const root = load(locale, slug);
    const broken = root
      .querySelectorAll('a[href]')
      .map((a) => a.getAttribute('href')!)
      .filter((h) => h.startsWith('/') && !APP_ROUTES.some((re) => re.test(h)) && !targetExists(h));
    expect(broken, 'broken internal links').toEqual([]);
    expect(root.querySelectorAll('a[href="#"]').length, 'no placeholder links').toBe(0);
    const external = [
      ...root.querySelectorAll('script[src]').map((e) => e.getAttribute('src')!),
      ...root.querySelectorAll('link[rel="stylesheet"],link[rel="preload"],link[rel="preconnect"]').map((e) => e.getAttribute('href')!),
      ...root.querySelectorAll('img[src],iframe[src],source[src]').map((e) => e.getAttribute('src')!),
    ].filter((u) => /^(https?:)?\/\//.test(u));
    expect(external, 'no resource may load from another host').toEqual([]);
    expect(root.toString()).not.toMatch(/googletagmanager|google-analytics|fonts\.googleapis|fonts\.gstatic/);
  });

  it.each(pages.map((p) => [p.label, p] as const))('%s gives every image a text alternative and links the machine-readable files', (_l, { locale, slug }) => {
    const root = load(locale, slug);
    for (const img of root.querySelectorAll('img')) expect(img.hasAttribute('alt'), img.toString()).toBe(true);
    const links = root.querySelectorAll('footer a').map((a) => a.getAttribute('href'));
    for (const f of ['/llms.txt', '/llms-full.txt', '/pricing.md', '/sitemap.xml']) expect(links).toContain(f);
  });

  it('uses a different title and description on every page of a language', () => {
    for (const locale of locales) {
      const heads = PAGE_SLUGS.map((slug) => load(locale, slug));
      expect(new Set(heads.map((r) => r.querySelector('title')?.text)).size).toBe(PAGE_SLUGS.length);
      expect(new Set(heads.map((r) => meta(r, 'meta[name="description"]'))).size).toBe(PAGE_SLUGS.length);
    }
  });
});

suite('discovery files', () => {
  const read = (f: string) => readFileSync(join(DIST, f), 'utf8');

  it('robots.txt uses one wildcard group, allows AI crawlers, hides only the app and API, and points to the sitemap', () => {
    const robots = read('robots.txt');
    expect(robots).toMatch(/^User-agent: \*/m);
    expect(robots.match(/^User-agent:/gm)).toHaveLength(1); // a named group would silently replace these rules
    expect(robots).toMatch(/^Allow: \/$/m);
    expect(robots).toMatch(/^Disallow: \/app\/$/m);
    expect(robots).toMatch(/^Disallow: \/api\/$/m);
    expect(robots).not.toMatch(/^Disallow: \/\s*$/m);
    expect(robots).toContain(`Sitemap: ${site.url}/sitemap.xml`);
  });

  it('sitemap.xml lists every page in both languages with alternates and a real lastmod', () => {
    const xml = read('sitemap.xml');
    for (const { locale, slug } of pages) {
      expect(xml).toContain(`<loc>${pageUrl(locale, slug)}</loc>`);
      expect(xml).toContain(content[locale][slug].updated);
    }
    expect((xml.match(/<url>/g) ?? []).length).toBe(pages.length);
    expect(xml).toContain('hreflang="x-default"');
  });

  it('llms.txt links every page and the machine-readable files; llms-full.txt carries every page', () => {
    const llms = read('llms.txt');
    const full = read('llms-full.txt');
    expect(llms).toMatch(/^# Orbyte/m);
    expect(llms).toMatch(/^> /m);
    for (const { locale, slug } of pages) {
      expect(llms).toContain(pageUrl(locale, slug));
      expect(full).toContain(`# ${fill(content[locale][slug].h1)}`);
    }
    for (const f of ['/llms-full.txt', '/pricing.md', '/sitemap.xml']) expect(llms).toContain(f);
  });

  it('pricing.md and the pricing page state the same plans and prices as text', () => {
    const md = read('pricing.md');
    const usdPage = parse(readFileSync(fileFor('en', 'pricing'), 'utf8')).querySelector('main')!.text.replace(/\s+/g, ' ');
    const idrPage = parse(readFileSync(fileFor('id', 'pricing'), 'utf8')).querySelector('main')!.text.replace(/\s+/g, ' ');
    for (const p of plans) {
      expect(md).toContain(`## ${p.name}`);
      expect(usdPage).toContain(p.name);
      if (p.usdAnnual) {
        expect(md).toContain(`$${p.usdAnnual}`);
        expect(usdPage).toContain(`$${p.usdAnnual}`);
      }
      if (p.idrAnnual) {
        const idr = `Rp ${String(p.idrAnnual).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
        expect(md).toContain(idr);
        expect(idrPage).toContain(idr);
      }
    }
    expect(usdPage).toMatch(/planned|not live/i); // honest status next to the prices (BR-M16-26)
  });

  it('renders Open Graph images at 1200x630 and keeps the app and 404 out of the index', async () => {
    for (const locale of locales) {
      const meta = await sharp(join(DIST, 'og', `${locale}.png`)).metadata();
      expect([meta.width, meta.height, meta.format]).toEqual([1200, 630, 'png']);
    }
    expect(read('404.html')).toMatch(/noindex/);
  });
});
