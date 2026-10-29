import { createRequire } from 'node:module';
import * as fontkit from 'fontkit';
import sharp from 'sharp';
import { applyLogo } from './poster';
import type { Corner } from './rules';

const require = createRequire(import.meta.url);

export type TextPosition = 'top' | 'bottom';

export interface PosterText {
  headline: string;
  subheadline?: string | null;
  cta?: string | null;
}

export interface RenderInput {
  /** The model's picture, without text or logo. */
  background: Uint8Array;
  /** The real logo, or null for a poster without one. */
  logo: Uint8Array | null;
  text: PosterText;
  /** A ready line such as "Mulai dari Rp 450.000 per bulan", made by code from an official package; null for none. */
  priceLine: string | null;
  textPosition: TextPosition;
  corner: Corner;
  /** First brand colour as `#rrggbb`, used for the call to action button. */
  accent?: string | null;
}

type Font = ReturnType<typeof fontkit.openSync>;
const fonts = new Map<400 | 700, Font>();

/** IBM Plex Sans is already bundled for the invoice PDF; text is drawn from its outlines so no system font is ever needed. */
function loadFont(weight: 400 | 700): Font {
  let font = fonts.get(weight);
  if (!font) {
    font = fontkit.openSync(require.resolve(`@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-${weight}-normal.woff`)) as Font;
    fonts.set(weight, font);
  }
  return font;
}

const scaleOf = (font: Font, size: number) => size / font.unitsPerEm;

/** Width of a line in pixels, kerning included. */
export function measure(font: Font, text: string, size: number): number {
  const run = font.layout(text);
  return run.positions.reduce((sum, p) => sum + p.xAdvance, 0) * scaleOf(font, size);
}

/** Greedy word wrap by real glyph widths. A word wider than the line is cut by characters, never allowed to overflow. */
export function wrap(font: Font, text: string, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = '';
  const push = () => {
    if (line) lines.push(line);
    line = '';
  };
  for (const word of text.trim().split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (measure(font, next, size) <= maxWidth) {
      line = next;
      continue;
    }
    push();
    if (measure(font, word, size) <= maxWidth) {
      line = word;
      continue;
    }
    let piece = '';
    for (const ch of word) {
      if (measure(font, piece + ch, size) > maxWidth && piece) {
        lines.push(piece);
        piece = '';
      }
      piece += ch;
    }
    line = piece;
  }
  push();
  return lines;
}

/** Shrinks the type until the text fits in `maxLines`; at the smallest size the last line ends in an ellipsis instead of overflowing. */
export function fit(font: Font, text: string, startSize: number, minSize: number, maxWidth: number, maxLines: number): { size: number; lines: string[] } {
  let size = startSize;
  for (;;) {
    const lines = wrap(font, text, size, maxWidth);
    if (lines.length <= maxLines) return { size, lines };
    if (size <= minSize) {
      const kept = lines.slice(0, maxLines);
      let last = kept[maxLines - 1];
      while (last.length > 1 && measure(font, `${last}…`, size) > maxWidth) last = last.slice(0, -1);
      kept[maxLines - 1] = `${last.trimEnd()}…`;
      return { size, lines: kept };
    }
    size = Math.max(minSize, size * 0.94);
  }
}

/** One line of text as SVG paths at a baseline, from the font's outlines. */
function linePaths(font: Font, text: string, size: number, x: number, baseline: number, fill: string): string {
  const run = font.layout(text);
  const s = scaleOf(font, size);
  let cursor = x;
  const out: string[] = [];
  run.glyphs.forEach((glyph, i) => {
    const pos = run.positions[i];
    const d = glyph.path.toSVG();
    if (d) out.push(`<path d="${d}" transform="translate(${(cursor + pos.xOffset * s).toFixed(2)} ${(baseline - pos.yOffset * s).toFixed(2)}) scale(${s.toFixed(5)} ${(-s).toFixed(5)})" fill="${fill}"/>`);
    cursor += pos.xAdvance * s;
  });
  return out.join('');
}

const HEX = /^#[0-9a-f]{6}$/i;
const DEFAULT_ACCENT = '#F4C95D';
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** Mixes a colour toward white so it stays readable on the dark gradient. */
const lighten = (hex: string, amount: number) => `#${[1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) + (255 - parseInt(hex.slice(i, i + 2), 16)) * amount).toString(16).padStart(2, '0')).join('')}`;

/** The first `#rrggbb` found in free text such as a brand kit's colour list, or null. */
export function firstHex(text: string | null | undefined): string | null {
  const m = text ? /#[0-9a-f]{6}\b/i.exec(text) : null;
  return m && HEX.test(m[0]) ? m[0].toUpperCase() : null;
}

/** The side of the picture the logo goes to: the opposite of the text, so the two never collide. */
export function logoCorner(corner: Corner, textPosition: TextPosition): Corner {
  const [vertical, horizontal] = corner.split('_') as ['top' | 'bottom', 'left' | 'right'];
  const side = vertical === textPosition ? (textPosition === 'top' ? 'bottom' : 'top') : vertical;
  return `${side}_${horizontal}` as Corner;
}

/**
 * Draws the poster: a dark gradient on the text side of the picture, headline, subheadline, an optional price line and a
 * call to action button, then the real logo on the other side. All text comes from font outlines, so the spelling is
 * exactly what was passed in (D-067).
 */
export async function renderPoster(input: RenderInput): Promise<Buffer> {
  const base = sharp(input.background);
  const { width: W = 0, height: H = 0 } = await base.metadata();
  if (!W || !H) throw new Error('picture has no size');
  const bold = loadFont(700);
  const regular = loadFont(400);
  const margin = Math.round(W * 0.08);
  const maxW = W - margin * 2;
  const accent = input.accent && HEX.test(input.accent) ? input.accent : DEFAULT_ACCENT;
  const pillInk = luminance(accent) > 0.55 ? '#10203A' : '#FFFFFF';

  const headline = fit(bold, input.text.headline, W * 0.092, W * 0.05, maxW, 3);
  const sub = input.text.subheadline?.trim() ? fit(regular, input.text.subheadline.trim(), W * 0.038, W * 0.027, maxW, 3) : null;
  const price = input.priceLine?.trim() ? fit(bold, input.priceLine.trim(), W * 0.042, W * 0.03, maxW, 2) : null;
  const ctaText = input.text.cta?.trim() ?? '';
  const ctaSize = W * 0.04;
  const ctaPadX = ctaSize * 1.1;
  const ctaH = ctaSize * 2.1;
  const ctaW = ctaText ? Math.min(maxW, measure(bold, ctaText, ctaSize) + ctaPadX * 2) : 0;

  // Heights of the stack, top to bottom, with a gap between parts.
  const gap = W * 0.03;
  const headLine = headline.size * 1.12;
  const subLine = sub ? sub.size * 1.35 : 0;
  const priceLineH = price ? price.size * 1.3 : 0;
  const blockH = headline.lines.length * headLine + (sub ? gap * 0.6 + sub.lines.length * subLine : 0) + (price ? gap * 0.8 + price.lines.length * priceLineH : 0) + (ctaText ? gap + ctaH : 0);
  const edge = H * 0.06;
  const top = input.textPosition === 'top' ? edge : H - edge - blockH;

  let y = top;
  const parts: string[] = [];
  headline.lines.forEach((line) => {
    parts.push(linePaths(bold, line, headline.size, margin, y + headline.size * 0.86, '#FFFFFF'));
    y += headLine;
  });
  if (sub) {
    y += gap * 0.6;
    sub.lines.forEach((line) => {
      parts.push(linePaths(regular, line, sub.size, margin, y + sub.size * 0.95, '#FFFFFF'));
      y += subLine;
    });
  }
  if (price) {
    y += gap * 0.8;
    price.lines.forEach((line) => {
      parts.push(linePaths(bold, line, price.size, margin, y + price.size, lighten(accent, 0.55)));
      y += priceLineH;
    });
  }
  if (ctaText) {
    y += gap;
    parts.push(`<rect x="${margin}" y="${y.toFixed(2)}" width="${ctaW.toFixed(2)}" height="${ctaH.toFixed(2)}" rx="${(ctaH / 2).toFixed(2)}" fill="${accent}"/>`);
    parts.push(linePaths(bold, ctaText, ctaSize, margin + (ctaW - measure(bold, ctaText, ctaSize)) / 2, y + ctaH / 2 + ctaSize * 0.36, pillInk));
  }

  // The dark gradient reaches a little past the text so every letter sits on it, and fades into the picture.
  const reach = Math.min(H * 0.7, blockH + edge * 2 + H * 0.12);
  const gradY = input.textPosition === 'top' ? [0, reach] : [H - reach, H];
  const stops = input.textPosition === 'top' ? [[0, 0.86], [0.7, 0.62], [1, 0]] : [[0, 0], [0.3, 0.62], [1, 0.86]];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs><linearGradient id="g" x1="0" y1="${gradY[0]}" x2="0" y2="${gradY[1]}" gradientUnits="userSpaceOnUse">${stops.map(([o, a]) => `<stop offset="${o}" stop-color="#0B1220" stop-opacity="${a}"/>`).join('')}</linearGradient></defs><rect x="0" y="${gradY[0].toFixed(2)}" width="${W}" height="${reach.toFixed(2)}" fill="url(#g)"/>${parts.join('')}</svg>`;

  const withText = await base.composite([{ input: Buffer.from(svg) }]).png().toBuffer();
  if (!input.logo) return sharp(withText).webp({ quality: 92 }).toBuffer();
  return applyLogo(withText, input.logo, logoCorner(input.corner, input.textPosition));
}
