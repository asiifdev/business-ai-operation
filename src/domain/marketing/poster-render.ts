import { createRequire } from 'node:module';
import * as fontkit from 'fontkit';
import sharp from 'sharp';
import { applyLogo } from './poster';
import type { Corner, Layout, TextPosition } from './rules';

const require = createRequire(import.meta.url);

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
  layout?: Layout;
  /** Where the words sit for `gradient`, `card` and `band`; the other looks place them themselves. */
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

/** Mixes a colour toward black. */
const darken = (hex: string, amount: number) => `#${[1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - amount)).toString(16).padStart(2, '0')).join('')}`;

/**
 * The side of the picture the logo goes to, so it never lands on the words: opposite the text for the looks that put text
 * at the top or bottom, the right-hand side when the text is a left panel, and where it was asked for when the text is centred.
 */
export function logoCorner(corner: Corner, textPosition: TextPosition, layout: Layout = 'gradient'): Corner {
  const [vertical, horizontal] = corner.split('_') as ['top' | 'bottom', 'left' | 'right'];
  if (layout === 'center') return corner;
  if (layout === 'side') return `${vertical}_right` as Corner;
  const side = vertical === textPosition ? (textPosition === 'top' ? 'bottom' : 'top') : vertical;
  return `${side}_${horizontal}` as Corner;
}

interface Palette {
  head: string;
  sub: string;
  price: string;
  ctaFill: string;
  ctaInk: string;
}

/**
 * Lays out the words once: headline, short line, price line and button, each fitted to the width. It reports its height so a
 * look can size its panel to it, and draws itself at any origin, left aligned or centred, in any palette (D-068).
 */
function buildStack(input: RenderInput, W: number, maxW: number, align: 'left' | 'center', palette: Palette, headlineScale = 1) {
  const bold = loadFont(700);
  const regular = loadFont(400);
  const headline = fit(bold, input.text.headline, W * 0.092 * headlineScale, W * 0.05, maxW, 3);
  const sub = input.text.subheadline?.trim() ? fit(regular, input.text.subheadline.trim(), W * 0.038, W * 0.027, maxW, 3) : null;
  const price = input.priceLine?.trim() ? fit(bold, input.priceLine.trim(), W * 0.042, W * 0.03, maxW, 2) : null;
  const ctaText = input.text.cta?.trim() ?? '';
  const ctaSize = W * 0.04;
  const ctaH = ctaSize * 2.1;
  const ctaTextW = ctaText ? measure(bold, ctaText, ctaSize) : 0;
  const ctaW = ctaText ? Math.min(maxW, ctaTextW + ctaSize * 2.2) : 0;
  const gap = W * 0.03;
  const headLine = headline.size * 1.12;
  const subLine = sub ? sub.size * 1.35 : 0;
  const priceLineH = price ? price.size * 1.3 : 0;
  const height = headline.lines.length * headLine + (sub ? gap * 0.6 + sub.lines.length * subLine : 0) + (price ? gap * 0.8 + price.lines.length * priceLineH : 0) + (ctaText ? gap + ctaH : 0);

  const xFor = (x0: number, width: number) => (align === 'center' ? x0 + (maxW - width) / 2 : x0);
  const draw = (x0: number, y0: number): string => {
    let y = y0;
    const out: string[] = [];
    for (const line of headline.lines) {
      out.push(linePaths(bold, line, headline.size, xFor(x0, measure(bold, line, headline.size)), y + headline.size * 0.86, palette.head));
      y += headLine;
    }
    if (sub) {
      y += gap * 0.6;
      for (const line of sub.lines) {
        out.push(linePaths(regular, line, sub.size, xFor(x0, measure(regular, line, sub.size)), y + sub.size * 0.95, palette.sub));
        y += subLine;
      }
    }
    if (price) {
      y += gap * 0.8;
      for (const line of price.lines) {
        out.push(linePaths(bold, line, price.size, xFor(x0, measure(bold, line, price.size)), y + price.size, palette.price));
        y += priceLineH;
      }
    }
    if (ctaText) {
      y += gap;
      const bx = xFor(x0, ctaW);
      out.push(`<rect x="${bx.toFixed(2)}" y="${y.toFixed(2)}" width="${ctaW.toFixed(2)}" height="${ctaH.toFixed(2)}" rx="${(ctaH / 2).toFixed(2)}" fill="${palette.ctaFill}"/>`);
      out.push(linePaths(bold, ctaText, ctaSize, bx + (ctaW - ctaTextW) / 2, y + ctaH / 2 + ctaSize * 0.36, palette.ctaInk));
    }
    return out.join('');
  };
  return { height, draw };
}

const gradient = (id: string, x1: number, y1: number, x2: number, y2: number, stops: Array<[number, number]>, color = '#0B1220') =>
  `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" gradientUnits="userSpaceOnUse">${stops.map(([o, a]) => `<stop offset="${o}" stop-color="${color}" stop-opacity="${a}"/>`).join('')}</linearGradient>`;

/**
 * Draws the poster in one of the looks (D-068): the words, the button and the real logo are drawn from font outlines over the
 * model's picture, so the spelling is exactly what was passed in (D-067). Every look keeps the words inside the picture.
 */
export async function renderPoster(input: RenderInput): Promise<Buffer> {
  const base = sharp(input.background);
  const { width: W = 0, height: H = 0 } = await base.metadata();
  if (!W || !H) throw new Error('picture has no size');
  const layout: Layout = input.layout ?? 'gradient';
  const margin = Math.round(W * 0.08);
  const edge = H * 0.06;
  const accent = input.accent && HEX.test(input.accent) ? input.accent : DEFAULT_ACCENT;
  const accentInk = luminance(accent) > 0.55 ? '#10203A' : '#FFFFFF';
  const dark: Palette = { head: '#FFFFFF', sub: '#FFFFFF', price: lighten(accent, 0.55), ctaFill: accent, ctaInk: accentInk };
  let svgBody = '';

  if (layout === 'center') {
    const stack = buildStack(input, W, W - margin * 2, 'center', dark, 1.08);
    const y0 = Math.max(edge, (H - stack.height) / 2);
    svgBody = `<rect width="${W}" height="${H}" fill="#0B1220" fill-opacity="0.58"/>${stack.draw(margin, y0)}`;
  } else if (layout === 'card') {
    const inner = W * 0.05;
    const cardX = Math.round(W * 0.06);
    const cardW = W - cardX * 2;
    const ink: Palette = { head: '#14213D', sub: '#3A4660', price: darken(accent, 0.25), ctaFill: accent, ctaInk: accentInk };
    const stack = buildStack(input, W, cardW - inner * 2, 'left', ink, 0.92);
    const cardH = stack.height + inner * 2;
    const cardY = input.textPosition === 'top' ? edge : H - edge - cardH;
    svgBody = `<rect x="${cardX}" y="${cardY.toFixed(2)}" width="${cardW}" height="${cardH.toFixed(2)}" rx="${(W * 0.035).toFixed(2)}" fill="#FBF7EF" fill-opacity="0.95"/>${stack.draw(cardX + inner, cardY + inner)}`;
  } else if (layout === 'band') {
    const bandColor = input.accent && HEX.test(input.accent) ? darken(input.accent, 0.45) : '#12243F';
    const pal: Palette = { head: '#FFFFFF', sub: '#EDEFF5', price: lighten(accent, 0.6), ctaFill: '#FFFFFF', ctaInk: bandColor };
    const stack = buildStack(input, W, W - margin * 2, 'left', pal, 0.95);
    const pad = H * 0.04;
    const bandH = stack.height + pad * 2;
    const bandY = input.textPosition === 'top' ? 0 : H - bandH;
    svgBody = `<rect x="0" y="${bandY.toFixed(2)}" width="${W}" height="${bandH.toFixed(2)}" fill="${bandColor}"/>${stack.draw(margin, bandY + pad)}`;
  } else if (layout === 'side') {
    const panelW = W * 0.7;
    const stack = buildStack(input, W, W * 0.56 - margin * 0.4, 'left', dark, 0.95);
    const y0 = Math.max(edge, (H - stack.height) / 2);
    svgBody = `<defs>${gradient('g', 0, 0, panelW, 0, [[0, 0.9], [0.62, 0.7], [1, 0]])}</defs><rect x="0" y="0" width="${panelW.toFixed(2)}" height="${H}" fill="url(#g)"/>${stack.draw(margin, y0)}`;
  } else {
    // gradient: a dark fade on the text side that reaches a little past the words and melts into the picture.
    const stack = buildStack(input, W, W - margin * 2, 'left', dark);
    const top = input.textPosition === 'top' ? edge : H - edge - stack.height;
    const reach = Math.min(H * 0.7, stack.height + edge * 2 + H * 0.12);
    const gy: [number, number] = input.textPosition === 'top' ? [0, reach] : [H - reach, H];
    const stops: Array<[number, number]> = input.textPosition === 'top' ? [[0, 0.86], [0.7, 0.62], [1, 0]] : [[0, 0], [0.3, 0.62], [1, 0.86]];
    svgBody = `<defs>${gradient('g', 0, gy[0], 0, gy[1], stops)}</defs><rect x="0" y="${gy[0].toFixed(2)}" width="${W}" height="${reach.toFixed(2)}" fill="url(#g)"/>${stack.draw(margin, top)}`;
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${svgBody}</svg>`;
  const withText = await base.composite([{ input: Buffer.from(svg) }]).png().toBuffer();
  if (!input.logo) return sharp(withText).webp({ quality: 92 }).toBuffer();
  return applyLogo(withText, input.logo, logoCorner(input.corner, input.textPosition, layout));
}
