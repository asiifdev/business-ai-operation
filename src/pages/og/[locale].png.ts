import type { APIRoute } from 'astro';
import sharp from 'sharp';
import { brand } from '../../config/brand';
import { locales, type Locale } from '../../config/site';

export const prerender = true;

export function getStaticPaths() {
  return locales.map((locale) => ({ params: { locale } }));
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** Open Graph image rendered at build time from the brand config (D-034). Dark tile, contrast-corrected colours. */
export const GET: APIRoute = async ({ params }) => {
  const locale = params.locale as Locale;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#030b1b"/>
  <g transform="translate(120 215) scale(2.0)">
    <circle cx="50" cy="50" r="33" fill="none" stroke="#3b78d8" stroke-width="9"/>
    <circle cx="50" cy="50" r="9" fill="#8bd9d1"/>
    <circle cx="50" cy="17" r="8" fill="#8bd9d1"/>
    <circle cx="21.4" cy="66.5" r="8" fill="#8bd9d1"/>
    <circle cx="78.6" cy="66.5" r="8" fill="#8bd9d1"/>
  </g>
  <text x="360" y="300" font-family="DejaVu Sans, Verdana, sans-serif" font-size="92" font-weight="700" letter-spacing="14" fill="#fbfafc">${esc(brand.name.toUpperCase())}</text>
  <text x="362" y="372" font-family="DejaVu Sans, Verdana, sans-serif" font-size="30" letter-spacing="6" fill="#8bd9d1">${esc(brand.tagline[locale].toUpperCase())}</text>
</svg>`;
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  return new Response(new Uint8Array(png), { headers: { 'content-type': 'image/png' } });
};
