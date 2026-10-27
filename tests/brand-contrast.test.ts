import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** Logo colours must stay readable on both themes (WCAG non-text contrast >= 3:1). The owner's original ring was only 2.2:1. */
const css = readFileSync('src/styles/tokens.css', 'utf8');

function block(selector: string): string {
  const start = css.indexOf(selector);
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}' && --depth === 0) return css.slice(open, i);
  }
  throw new Error(`block ${selector} not found`);
}
const light = block('@theme');
const dark = block(':root[data-theme="dark"]');

function token(source: string, name: string): string {
  const m = new RegExp(`${name}:\\s*([^;]+);`).exec(source);
  if (!m) throw new Error(`token ${name} missing`);
  return m[1].trim();
}

/** Linear-light sRGB from "#rrggbb" or "oklch(L% C H)". */
function linear(color: string): [number, number, number] {
  if (color.startsWith('#')) {
    const n = parseInt(color.slice(1), 16);
    const c = (v: number) => {
      const s = v / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return [c((n >> 16) & 255), c((n >> 8) & 255), c(n & 255)];
  }
  const m = /oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)/.exec(color);
  if (!m) throw new Error(`unsupported colour ${color}`);
  const L = Number(m[1]) / 100, C = Number(m[2]), h = (Number(m[3]) * Math.PI) / 180;
  const a = C * Math.cos(h), b = C * Math.sin(h);
  const l_ = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return [
    clamp(4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_),
    clamp(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_),
    clamp(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.7076147010 * s_),
  ];
}
const lum = (c: string) => { const [r, g, b] = linear(c); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a: string, b: string) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

describe('logo contrast', () => {
  it.each([
    ['light', light, light],
    ['dark', dark, dark],
  ])('keeps the ring and nodes at 3:1 or more on %s paper', (_name, theme, base) => {
    const paper = token(theme, '--color-paper');
    for (const name of ['--color-brand-ring', '--color-brand-node']) {
      const ratio = contrast(token(theme, name), paper);
      expect(ratio, `${name} on ${_name} paper is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
    }
    expect(base).toBeTruthy();
  });

  it('measures the original ring colour as too dim, which is why the web version differs', () => {
    expect(contrast('#274b8c', '#030b1b')).toBeLessThan(3);
  });
});
