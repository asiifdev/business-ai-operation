import type { APIRoute } from 'astro';
import { locales, pageUrl } from '../config/site';
import { PAGE_SLUGS } from '../content/site/types';
import { alternates, getPage } from '../lib/marketing';

export const prerender = true;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const GET: APIRoute = () => {
  const urls = PAGE_SLUGS.flatMap((slug) =>
    locales.map((locale) => {
      const links = alternates(slug).map((a) => `    <xhtml:link rel="alternate" hreflang="${a.hreflang}" href="${esc(a.href)}"/>`).join('\n');
      return `  <url>\n    <loc>${esc(pageUrl(locale, slug))}</loc>\n    <lastmod>${getPage(locale, slug).updated}</lastmod>\n${links}\n  </url>`;
    }),
  );
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join('\n')}\n</urlset>\n`;
  return new Response(xml, { headers: { 'content-type': 'application/xml; charset=utf-8' } });
};
