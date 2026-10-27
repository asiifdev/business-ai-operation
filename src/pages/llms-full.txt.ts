import type { APIRoute } from 'astro';
import { brand } from '../config/brand';
import { locales } from '../config/site';
import { PAGE_SLUGS } from '../content/site/types';
import { pageToMarkdown, siteSummary } from '../lib/markdown';

export const prerender = true;

export const GET: APIRoute = () => {
  const out = [`# ${brand.name}: full public content`, '', `> ${siteSummary('en')}`, ''];
  for (const locale of locales) {
    out.push(`---`, '', locale === 'en' ? '# English' : '# Bahasa Indonesia', '');
    for (const slug of PAGE_SLUGS) out.push(pageToMarkdown(locale, slug), '');
  }
  return new Response(out.join('\n'), { headers: { 'content-type': 'text/plain; charset=utf-8' } });
};
