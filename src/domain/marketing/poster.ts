import sharp from 'sharp';
import type { Corner } from './rules';

/** The logo takes at most this share of the picture's width and height (D-066). */
const MAX_WIDTH_SHARE = 0.24;
const MAX_HEIGHT_SHARE = 0.14;
const MARGIN_SHARE = 0.04;

/**
 * Lays the organization's real logo onto a generated picture, in a corner, on a soft white plate so it stays readable on
 * any background. The model never draws a logo (it would invent one); this is the only place a logo gets on a poster.
 * Returns a WebP. A logo that cannot be read leaves the picture as it was rather than failing the whole poster.
 */
export async function applyLogo(image: Uint8Array, logo: Uint8Array, corner: Corner): Promise<Buffer> {
  const base = sharp(image);
  const { width = 0, height = 0 } = await base.metadata();
  if (!width || !height) throw new Error('picture has no size');
  const box = { width: Math.max(16, Math.round(width * MAX_WIDTH_SHARE)), height: Math.max(16, Math.round(height * MAX_HEIGHT_SHARE)) };
  const mark = await sharp(logo).resize(box.width, box.height, { fit: 'inside', withoutEnlargement: false }).toBuffer({ resolveWithObject: true });
  const pad = Math.max(6, Math.round(Math.min(width, height) * 0.015));
  const plateW = mark.info.width + pad * 2;
  const plateH = mark.info.height + pad * 2;
  const plate = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${plateW}" height="${plateH}"><rect width="${plateW}" height="${plateH}" rx="${Math.round(pad * 1.2)}" fill="#ffffff" fill-opacity="0.88"/></svg>`);
  const margin = Math.round(Math.min(width, height) * MARGIN_SHARE);
  const left = corner.endsWith('left') ? margin : Math.max(0, width - plateW - margin);
  const top = corner.startsWith('top') ? margin : Math.max(0, height - plateH - margin);
  return base
    .composite([
      { input: plate, left, top },
      { input: mark.data, left: left + pad, top: top + pad },
    ])
    .webp({ quality: 92 })
    .toBuffer();
}
