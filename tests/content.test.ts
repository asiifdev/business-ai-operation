import { describe, expect, it } from 'vitest';
import { en } from '../src/content/site/en';
import { id } from '../src/content/site/id';
import { PAGE_SLUGS, type PageContent } from '../src/content/site/types';
import { ui } from '../src/content/site/ui';
import { wordCount } from '../src/lib/marketing';

const langs = { en, id } as const;
const all = (Object.entries(langs) as [keyof typeof langs, Record<string, PageContent>][]).flatMap(([lang, pages]) => PAGE_SLUGS.map((slug) => ({ lang, slug, page: pages[slug] })));

describe('page content', () => {
  it('has the same pages in English and Indonesian', () => {
    expect(Object.keys(en).sort()).toEqual([...PAGE_SLUGS].sort());
    expect(Object.keys(id).sort()).toEqual([...PAGE_SLUGS].sort());
  });

  it.each(all.map((x) => [`${x.lang}/${x.slug || 'home'}`, x] as const))('%s: direct answer is 38 to 70 words (BR-M16-19)', (_n, { page }) => {
    const n = wordCount(page.answer);
    expect(n, `answer has ${n} words`).toBeGreaterThanOrEqual(38);
    expect(n, `answer has ${n} words`).toBeLessThanOrEqual(70);
  });

  it.each(all.map((x) => [`${x.lang}/${x.slug || 'home'}`, x] as const))('%s: title and description fit search results (BR-M16-13)', (_n, { page }) => {
    const title = page.title.replaceAll('{brand}', 'Orbyte');
    const desc = page.description.replaceAll('{brand}', 'Orbyte');
    expect(title.length, `title is ${title.length} chars`).toBeLessThanOrEqual(60);
    expect(desc.length, `description is ${desc.length} chars`).toBeLessThanOrEqual(160);
    expect(desc.length).toBeGreaterThanOrEqual(70);
  });

  it('has unique titles and descriptions per language', () => {
    for (const lang of ['en', 'id'] as const) {
      const pages = all.filter((x) => x.lang === lang);
      expect(new Set(pages.map((p) => p.page.title)).size).toBe(pages.length);
      expect(new Set(pages.map((p) => p.page.description)).size).toBe(pages.length);
    }
  });

  it('uses only known placeholders', () => {
    for (const { lang, slug, page } of all) {
      const text = JSON.stringify(page);
      const unknown = [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).filter((k) => !['email', 'brand'].includes(k));
      expect(unknown, `${lang}/${slug}`).toEqual([]);
    }
  });

  it('dates every page with a real, past ISO date (freshness, BR-M16-25)', () => {
    for (const { lang, slug, page } of all) {
      expect(page.updated, `${lang}/${slug}`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(new Date(page.updated).getTime()).toBeLessThanOrEqual(Date.now() + 86_400_000);
    }
  });

  it('does not promise features the product will not have (CR-17)', () => {
    const banned = /\b(video generation|text-to-speech|voice generation|embeddings?)\b/i;
    for (const { lang, slug, page } of all) {
      const text = JSON.stringify(page).replace(/does not generate video or voice|no video generation|not generate video|tidak membuat video|tanpa pembuatan video/gi, '');
      expect(banned.test(text), `${lang}/${slug} mentions a feature that does not exist`).toBe(false);
    }
  });

  it('does not invent metrics, testimonials or customer logos (BR-M16-01)', () => {
    const fake = /\b(\d{2,}\s?(\+|%)\s?(customers|users|teams|pelanggan|pengguna)|trusted by|dipercaya oleh|testimonial(s)? from)\b/i;
    for (const { lang, slug, page } of all) expect(fake.test(JSON.stringify(page)), `${lang}/${slug}`).toBe(false);
  });
});

describe('interface strings', () => {
  const shape = (o: unknown, prefix = ''): string[] =>
    typeof o === 'object' && o !== null
      ? Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => (Array.isArray(v) ? [`${prefix}${k}[${v.length}]`, ...v.flatMap((x, i) => shape(x, `${prefix}${k}.${i}.`))] : shape(v, `${prefix}${k}.`)))
      : [prefix.slice(0, -1)];
  it('has identical keys in both languages', () => {
    expect(shape(ui.id).sort()).toEqual(shape(ui.en).sort());
  });
});

describe('home hero', () => {
  it('highlights a phrase that really is part of the h1, in both languages', () => {
    for (const lang of ['en', 'id'] as const) {
      const home = langs[lang][''];
      expect(home.home, `${lang} home needs home content`).toBeTruthy();
      expect(home.h1.includes(home.home!.h1Accent), `${lang}: h1Accent must be a substring of h1`).toBe(true);
    }
  });
});
