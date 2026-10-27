import type { APIRoute } from 'astro';
import { brand } from '../config/brand';
import { locales, pageUrl, site } from '../config/site';
import { PAGE_SLUGS } from '../content/site/types';
import { fill, getPage } from '../lib/marketing';
import { siteSummary } from '../lib/markdown';

export const prerender = true;

/** llms.txt (llmstxt.org): generated from the same page content, never written separately (BR-M16-22). */
export const GET: APIRoute = () => {
  const out = [`# ${brand.name}`, '', `> ${siteSummary('en')}`, ''];
  for (const locale of locales) {
    out.push(locale === 'en' ? '## Pages (English)' : '## Halaman (Bahasa Indonesia)', '');
    for (const slug of PAGE_SLUGS) {
      const p = getPage(locale, slug);
      out.push(`- [${fill(p.h1)}](${pageUrl(locale, slug)}): ${fill(p.description)}`);
    }
    out.push('');
  }
  out.push(
    '## Machine-readable',
    '',
    `- [Full content in one file](${site.url}/llms-full.txt): every public page as Markdown`,
    `- [Pricing as plain text](${site.url}/pricing.md): planned plans and limits`,
    `- [Sitemap](${site.url}/sitemap.xml)`,
    '',
    '## Publisher',
    '',
    `- [${brand.publisher.legalName}](${brand.publisher.url}): the company that builds ${brand.name}`,
    `- [Source repository](${brand.repository})`,
    '',
  );
  return new Response(out.join('\n'), { headers: { 'content-type': 'text/plain; charset=utf-8' } });
};
