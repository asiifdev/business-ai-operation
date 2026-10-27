import { brand } from '../config/brand';
import { defaultLocale, locales, pagePath, pageUrl, site, type Locale } from '../config/site';
import { en } from '../content/site/en';
import { id } from '../content/site/id';
import { PAGE_SLUGS, type PageContent, type PageSlug } from '../content/site/types';

const content: Record<Locale, Record<PageSlug, PageContent>> = { en, id };

/** Replaces {email} and {brand} tokens in content strings. */
export const fill = (text: string): string => text.replaceAll('{email}', site.contactEmail ?? brand.contactEmail).replaceAll('{brand}', brand.name);

export const publishedSlugs = (): PageSlug[] => [...PAGE_SLUGS];
export const getPage = (locale: Locale, slug: PageSlug): PageContent => content[locale][slug];
export const isSlug = (value: string): value is PageSlug => (PAGE_SLUGS as readonly string[]).includes(value);

export const wordCount = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

export function alternates(slug: PageSlug) {
  return [
    ...locales.map((l) => ({ hreflang: l as string, href: pageUrl(l, slug) })),
    { hreflang: 'x-default', href: pageUrl(defaultLocale, slug) },
  ];
}

export const href = (locale: Locale, slug: PageSlug) => pagePath(locale, slug);

/** The same page in the other language, for the language switch. */
export const otherLocale = (locale: Locale): Locale => (locale === 'en' ? 'id' : 'en');

export interface Crumb {
  name: string;
  url: string;
}

export function breadcrumbs(locale: Locale, slug: PageSlug, homeLabel: string): Crumb[] {
  const crumbs: Crumb[] = [{ name: homeLabel, url: pageUrl(locale, '') }];
  if (slug.startsWith('product/')) crumbs.push({ name: getPage(locale, 'product').h1, url: pageUrl(locale, 'product') });
  if (slug !== '') crumbs.push({ name: getPage(locale, slug).h1, url: pageUrl(locale, slug) });
  return crumbs;
}
