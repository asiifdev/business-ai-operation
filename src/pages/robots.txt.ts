import type { APIRoute } from 'astro';
import { site } from '../config/site';

export const prerender = true;

/**
 * One wildcard group (D-034): every crawler, including AI search, user-triggered fetchers and model-training
 * crawlers, may read the public site. Only the signed-in app and the API are excluded. A named group would
 * replace these rules for that bot, so none is used.
 */
export const GET: APIRoute = () => {
  const body = [
    '# Public pages are open to all crawlers, including AI search and training crawlers (owner decision D-034).',
    'User-agent: *',
    'Allow: /',
    'Disallow: /app/',
    'Disallow: /api/',
    '',
    `Sitemap: ${site.url}/sitemap.xml`,
    '',
  ].join('\n');
  return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
};
