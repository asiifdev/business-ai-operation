import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Header, content and footer must share ONE container so their edges line up. Two different max-width containers
 * (the navbar was wider than the content) made the page look imprecise. Use the `.wrap` class from global.css.
 */
const dirs = ['src/components/marketing', 'src/layouts'];
const files = dirs.flatMap((d) => readdirSync(d).filter((f) => /\.(astro|tsx)$/.test(f)).map((f) => join(d, f)));
const css = readFileSync('src/styles/global.css', 'utf8');

describe('public-site container', () => {
  it('defines a single .wrap container', () => {
    expect((css.match(/^\.wrap\s*\{/gm) ?? []).length).toBe(1);
    expect(css).toMatch(/\.wrap\s*\{[^}]*max-width:\s*72rem/);
  });

  it.each(files.map((f) => [f] as const))('%s does not set its own page-width container', (f) => {
    const text = readFileSync(f, 'utf8');
    // max-w-* utilities on text blocks (prose width) are fine below 3xl; a page-wide container is not.
    expect(text, `${f} uses a page-wide max-w container; use .wrap`).not.toMatch(/\bmax-w-(5xl|6xl|7xl)\b/);
  });

  it('is used by the header, footer and page content', () => {
    for (const f of ['Header.astro', 'Footer.astro', 'MarketingPage.astro']) {
      expect(readFileSync(join('src/components/marketing', f), 'utf8'), `${f} must use .wrap`).toMatch(/\bwrap\b/);
    }
  });
});
