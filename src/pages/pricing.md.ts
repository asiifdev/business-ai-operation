import type { APIRoute } from 'astro';
import { pricingMarkdown } from '../lib/markdown';

export const prerender = true;

/** Plain-text pricing for agents that compare products programmatically (BR-M16-22). Same data as /pricing. */
export const GET: APIRoute = () => {
  const body = `${pricingMarkdown('en')}\n---\n\n${pricingMarkdown('id')}`;
  return new Response(body, { headers: { 'content-type': 'text/markdown; charset=utf-8' } });
};
