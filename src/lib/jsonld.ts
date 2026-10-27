import { brand } from '../config/brand';
import { pageUrl, site, locales, type Locale } from '../config/site';
import { fill, getPage, breadcrumbs } from './marketing';
import type { PageSlug } from '../content/site/types';

const orgId = `${site.url}/#publisher`;
const siteId = `${site.url}/#website`;

/**
 * JSON-LD for one page. Everything stated here is also visible text on the page (BR-M16-20).
 * No Offer is emitted: plans are planned, not purchasable (BR-M16-26). FAQPage is semantic markup for visible FAQs only.
 */
export function buildJsonLd(locale: Locale, slug: PageSlug, homeLabel: string) {
  const page = getPage(locale, slug);
  const graph: Record<string, unknown>[] = [
    {
      '@type': 'Organization',
      '@id': orgId,
      name: brand.publisher.legalName,
      alternateName: brand.publisher.brand,
      url: brand.publisher.url,
      foundingDate: brand.publisher.founded,
      address: { '@type': 'PostalAddress', addressLocality: brand.publisher.locality, addressRegion: brand.publisher.region, addressCountry: brand.publisher.country },
      contactPoint: { '@type': 'ContactPoint', contactType: 'customer support', email: site.contactEmail, availableLanguage: ['English', 'Indonesian'] },
    },
    {
      '@type': 'WebSite',
      '@id': siteId,
      name: brand.name,
      url: `${site.url}/`,
      inLanguage: [...locales],
      publisher: { '@id': orgId },
    },
  ];

  if (slug === '' || slug === 'product') {
    graph.push({
      '@type': 'SoftwareApplication',
      name: brand.name,
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web',
      description: fill(page.answer),
      url: pageUrl(locale, slug),
      inLanguage: locale,
      publisher: { '@id': orgId },
    });
  }

  if (slug !== '') {
    graph.push({
      '@type': 'BreadcrumbList',
      itemListElement: breadcrumbs(locale, slug, homeLabel).map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: fill(c.name), item: c.url })),
    });
  }

  const faq = slug === 'faq' ? page.faq : undefined;
  if (faq?.length) {
    graph.push({
      '@type': 'FAQPage',
      mainEntity: faq.map((f) => ({ '@type': 'Question', name: fill(f.q), acceptedAnswer: { '@type': 'Answer', text: fill(f.a) } })),
    });
  }

  graph.push({
    '@type': 'WebPage',
    '@id': `${pageUrl(locale, slug)}#webpage`,
    url: pageUrl(locale, slug),
    name: fill(page.title),
    description: fill(page.description),
    inLanguage: locale,
    dateModified: page.updated,
    isPartOf: { '@id': siteId },
  });

  return { '@context': 'https://schema.org', '@graph': graph };
}
