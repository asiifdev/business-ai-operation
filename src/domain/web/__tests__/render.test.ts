import { afterEach, describe, expect, it } from 'vitest';
import { embeddedText, hasPrice, looksEmpty, markdownToAnchors, priceLines, setRenderer } from '../render';
import { pickLinks, readSite } from '../site';

afterEach(() => setRenderer(undefined));

const SHELL = '<html><head><title>Invly</title></head><body><div id="root"></div><noscript>Please enable JavaScript to run this app.</noscript></body></html>';
const NEXT = `<html><body><div id="__next"></div><script id="__NEXT_DATA__" type="application/json">{"props":{"plans":[{"name":"Starter","price":150000,"features":["1 outlet","Laporan harian","Stok dan ketersediaan unit","Kontrak sewa otomatis","Denda keterlambatan"]},{"name":"Bisnis","price":350000,"id":987654}],"image":"/img/a.png"}}</script></body></html>`;
const LONG = `<html><head><title>Beranda</title></head><body><a href="/pricing">Harga</a><a href="/blog">Blog</a><p>${'Sistem manajemen persewaan. '.repeat(30)}</p></body></html>`;

describe('looksEmpty', () => {
  it('flags an app shell and accepts a real page', () => {
    expect(looksEmpty('', SHELL)).toBe(true);
    expect(looksEmpty('Sistem manajemen persewaan. '.repeat(30), LONG)).toBe(false);
  });
});

describe('embeddedText', () => {
  it('reads words and price-named numbers out of framework state, not ids or file names', () => {
    const t = embeddedText(NEXT);
    expect(t).toContain('Starter');
    expect(t).toContain('price: 150000');
    expect(t).toContain('Laporan harian');
    expect(t).not.toContain('987654');
    expect(t).not.toContain('a.png');
  });
  it('skips a script that is not JSON', () => {
    expect(embeddedText('<script type="application/json">{oops</script>')).toBe('');
  });
});

describe('prices', () => {
  const text = 'Paket\nStarter\nRp 150.000 /bulan\n1 outlet\n\nBisnis\nRp350rb/bulan';
  it('detects Indonesian price notations', () => {
    expect(hasPrice('Mulai dari Rp 150.000/bulan')).toBe(true);
    expect(hasPrice('IDR 1,5 jt')).toBe(true);
    expect(hasPrice('Hubungi kami')).toBe(false);
  });
  it('returns price lines together with the name that precedes them', () => {
    const lines = priceLines(text);
    expect(lines).toContain('Starter');
    expect(lines).toContain('Rp 150.000 /bulan');
    expect(lines).toContain('Rp350rb/bulan');
  });
});

describe('markdownToAnchors', () => {
  it('turns rendered links into anchors and drops images', () => {
    expect(markdownToAnchors('![x](https://a.id/i.png) [Harga](https://invly.id/pricing)')).toContain('<a href="https://invly.id/pricing">Harga</a>');
  });
});

describe('pickLinks with a price focus', () => {
  it('ranks a price page first when asked for prices', () => {
    const base = new URL('https://invly.id/');
    const html = '<a href="/tentang">Tentang</a><a href="/pricing">Harga</a>';
    expect(pickLinks(base, html, 2, 'pricing')[0]).toBe('https://invly.id/pricing');
  });
});

describe('readSite for prices', () => {
  it('renders an empty shell with a real browser and finds the prices there', async () => {
    setRenderer(async () => '# Harga\n\nStarter\n\nRp 150.000 /bulan\n\n[Daftar](https://invly.id/daftar)');
    const site = await readSite('https://invly.id', { focus: 'pricing', fetch: async (url) => ({ url, html: SHELL }) });
    expect(site.rendered).toBeGreaterThan(0);
    expect(site.pricing?.found).toBe(true);
    expect(site.pricing?.lines).toContain('Rp 150.000 /bulan');
  });

  it('reads framework state without any browser', async () => {
    let browser = 0;
    setRenderer(async () => (browser += 1, null));
    const site = await readSite('https://invly.id', { focus: 'pricing', fetch: async (url) => ({ url, html: NEXT }) });
    expect(site.pages[0]!.text).toContain('Starter');
    expect(browser).toBe(0);
  });

  it('does not give up when the linked pages show no price: it tries the usual price addresses', async () => {
    setRenderer(async () => null);
    const seen: string[] = [];
    const fetch = async (raw: string) => {
      const url = new URL(raw).href;
      seen.push(url);
      if (url === 'https://invly.id/harga') return { url, html: `<title>Harga</title><p>${'Paket lengkap untuk persewaan. '.repeat(15)} Starter Rp 150.000 /bulan</p>` };
      if (url === 'https://invly.id/') return { url, html: LONG.replace('/pricing', '/blog') };
      throw new Error('404');
    };
    const site = await readSite('https://invly.id', { focus: 'pricing', fetch });
    expect(seen).toContain('https://invly.id/pricing');
    expect(seen).toContain('https://invly.id/harga');
    expect(site.pricing?.found).toBe(true);
    expect(site.pricing?.tried).toContain('https://invly.id/pricing');
  });

  it('says plainly that no price was found, and which addresses were tried', async () => {
    setRenderer(async () => null);
    const site = await readSite('https://invly.id', { focus: 'pricing', fetch: async (url) => { if (url === 'https://invly.id') return { url, html: LONG.replace('/pricing', '/blog') }; throw new Error('404'); } });
    expect(site.pricing?.found).toBe(false);
    expect(site.pricing?.tried.length).toBeGreaterThan(3);
  });

  it('keeps the general reading unchanged: no price section, no probing', async () => {
    const seen: string[] = [];
    const site = await readSite('https://invly.id', { fetch: async (url) => (seen.push(url), { url, html: LONG }) });
    expect(site.pricing).toBeUndefined();
    expect(seen.every((u) => !u.endsWith('/harga'))).toBe(true);
  });
});
