import * as fontkit from 'fontkit';
import { createRequire } from 'node:module';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { firstHex, fit, logoCorner, measure, renderPoster, wrap } from '../poster-render';
import { copyWriterInstructions, fallbackCopy, fallbackImagePrompt, LAYOUTS, posterCopySchema, priceLine, promptWriterInstructions, spaceFor } from '../rules';

const require = createRequire(import.meta.url);
const bold = fontkit.openSync(require.resolve('@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-700-normal.woff'));

const pale = () => sharp({ create: { width: 800, height: 1000, channels: 3, background: '#EFE6D6' } }).webp().toBuffer();
const logo = () => sharp({ create: { width: 300, height: 100, channels: 4, background: '#ff0000' } }).png().toBuffer();

async function reader(webp: Buffer) {
  const { data, info } = await sharp(webp).raw().toBuffer({ resolveWithObject: true });
  return { info, at: (x: number, y: number) => [data[(y * info.width + x) * info.channels], data[(y * info.width + x) * info.channels + 1], data[(y * info.width + x) * info.channels + 2]] };
}
const brightness = ([r, g, b]: number[]) => (r + g + b) / 3;

describe('D-067 text measuring and wrapping', () => {
  it('measures by real glyph widths: longer text is wider and size scales it', () => {
    expect(measure(bold, 'Kelola penyewaan', 40)).toBeGreaterThan(measure(bold, 'Kelola', 40));
    expect(measure(bold, 'Kelola', 80)).toBeCloseTo(measure(bold, 'Kelola', 40) * 2, 1);
  });

  it('wraps on word boundaries and never exceeds the width', () => {
    const lines = wrap(bold, 'Kelola penyewaan lebih rapi tanpa ribet sama sekali', 60, 400);
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(measure(bold, l, 60)).toBeLessThanOrEqual(400);
    expect(lines.join(' ')).toBe('Kelola penyewaan lebih rapi tanpa ribet sama sekali');
  });

  it('cuts a word wider than the line by characters instead of overflowing', () => {
    const lines = wrap(bold, 'Pneumonoultramicroscopicsilicovolcanoconiosis', 60, 300);
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(measure(bold, l, 60)).toBeLessThanOrEqual(300);
  });

  it('shrinks to fit the allowed lines, and ends with an ellipsis rather than overflow at the smallest size', () => {
    const roomy = fit(bold, 'Judul pendek', 80, 30, 600, 2);
    expect(roomy.size).toBe(80);
    const tight = fit(bold, 'Judul yang sangat panjang sekali dan terus berlanjut tanpa henti sampai lebih dari batas baris yang diizinkan', 80, 60, 400, 2);
    expect(tight.lines).toHaveLength(2);
    expect(tight.lines[1].endsWith('…')).toBe(true);
    for (const l of tight.lines) expect(measure(bold, l, tight.size)).toBeLessThanOrEqual(400);
  });

  it('handles Indonesian and accented letters', () => {
    expect(wrap(bold, 'Pelajari selengkapnya, mudah & cepat!', 40, 2000)).toEqual(['Pelajari selengkapnya, mudah & cepat!']);
    expect(measure(bold, 'Café', 40)).toBeGreaterThan(0);
  });
});

describe('D-067 poster layout', () => {
  it('puts the logo on the side opposite the text', () => {
    expect(logoCorner('bottom_right', 'bottom')).toBe('top_right');
    expect(logoCorner('bottom_left', 'bottom')).toBe('top_left');
    expect(logoCorner('top_right', 'top')).toBe('bottom_right');
    expect(logoCorner('bottom_right', 'top')).toBe('bottom_right');
  });

  it('takes the first six-digit colour from a brand colour list', () => {
    expect(firstHex('biru tua, #1f3a5f dan #F4E9D8')).toBe('#1F3A5F');
    expect(firstHex('biru tua, krem')).toBeNull();
    expect(firstHex('#abc')).toBeNull();
    expect(firstHex(null)).toBeNull();
  });

  it('darkens the text side and leaves the far side of the picture untouched, for both positions', async () => {
    for (const position of ['bottom', 'top'] as const) {
      const out = await renderPoster({ background: new Uint8Array(await pale()), logo: null, text: { headline: 'Kelola penyewaan lebih rapi', subheadline: 'Stok, jadwal, dan tagihan dalam satu aplikasi.', cta: 'Coba sekarang' }, priceLine: null, textPosition: position, corner: 'bottom_right' });
      const { info, at } = await reader(out);
      expect([info.width, info.height]).toEqual([800, 1000]);
      const near = position === 'bottom' ? 960 : 40;
      const far = position === 'bottom' ? 40 : 960;
      expect(brightness(at(790, near)), `${position} near edge is dark`).toBeLessThan(90);
      expect(brightness(at(790, far)), `${position} far edge is untouched`).toBeGreaterThan(215);
    }
  });

  it('draws white text on the dark area and a button in the brand colour', async () => {
    const out = await renderPoster({ background: new Uint8Array(await pale()), logo: null, text: { headline: 'Halo dunia', subheadline: null, cta: 'Coba sekarang' }, priceLine: null, textPosition: 'bottom', corner: 'top_left', accent: '#1F8A70' });
    const { info, at } = await reader(out);
    let white = 0;
    let accent = 0;
    for (let y = 600; y < info.height; y += 2) for (let x = 0; x < info.width; x += 2) {
      const [r, g, b] = at(x, y);
      if (r > 235 && g > 235 && b > 235) white++;
      if (Math.abs(r - 0x1f) < 12 && Math.abs(g - 0x8a) < 12 && Math.abs(b - 0x70) < 12) accent++;
    }
    expect(white).toBeGreaterThan(200);
    expect(accent).toBeGreaterThan(500);
  });

  it('adds the real logo on the opposite side and a price line when given', async () => {
    const withPrice = await renderPoster({ background: new Uint8Array(await pale()), logo: new Uint8Array(await logo()), text: { headline: 'Halo dunia', subheadline: null, cta: null }, priceLine: 'Mulai dari Rp 450.000 per bulan', textPosition: 'bottom', corner: 'bottom_right' });
    const { at } = await reader(withPrice);
    let red = 0;
    for (let y = 20; y < 200; y += 3) for (let x = 560; x < 800; x += 3) if (at(x, y)[0] > 200 && at(x, y)[1] < 60) red++;
    expect(red, 'logo flipped to the top right').toBeGreaterThan(10);
  });

  it('keeps long words and many lines inside the picture', async () => {
    const out = await renderPoster({ background: new Uint8Array(await pale()), logo: null, text: { headline: 'Superkalifragilistikekspialidosiusuperpanjang '.repeat(3), subheadline: 'kata '.repeat(60), cta: 'Ajakan yang sangat panjang sekali untuk tombol' }, priceLine: null, textPosition: 'bottom', corner: 'top_left' });
    expect((await sharp(out).metadata()).width).toBe(800);
  });
});

describe('D-067 poster copy rules', () => {
  const product = { name: 'Orbit CRM', description: 'CRM sederhana untuk agensi kecil', packages: [] };
  it('falls back to words made only from the facts', () => {
    expect(fallbackCopy(product, { brandName: 'Aksara' }, 'launch', 'id')).toEqual({ headline: 'Orbit CRM', subheadline: 'CRM sederhana untuk agensi kecil', cta: 'Coba sekarang' });
    expect(fallbackCopy({ ...product, company: true, description: null }, { brandName: 'Aksara' }, 'brand', 'en')).toEqual({ headline: 'Aksara', subheadline: null, cta: 'Get to know us' });
    const long = fallbackCopy({ ...product, description: 'x'.repeat(300) }, { brandName: 'A' }, 'promo', 'id');
    expect(long.subheadline!.length).toBeLessThanOrEqual(150);
  });

  it('formats the price line in code in both languages', () => {
    expect(priceLine('id', 'Rp 450.000')).toBe('Mulai dari Rp 450.000 per bulan');
    expect(priceLine('en', 'Rp 450.000')).toBe('From Rp 450.000 a month');
  });

  it('forbids any figure or price in what the model writes', () => {
    expect(copyWriterInstructions('id', false)).toMatch(/Jangan menulis harga/);
    expect(copyWriterInstructions('en', true)).toMatch(/Never write a price/);
    expect(copyWriterInstructions('en', true)).toMatch(/about the company/);
  });
});

describe('D-068 poster looks', () => {
  const text = { headline: 'Rental jadi rapi', subheadline: 'Stok dan jadwal dalam satu aplikasi.', cta: 'Coba sekarang' };
  const draw = async (layout: (typeof LAYOUTS)[number], over: Record<string, unknown> = {}) =>
    reader(await renderPoster({ background: new Uint8Array(await pale()), logo: null, text, priceLine: null, layout, textPosition: 'bottom', corner: 'top_left', accent: '#1F8A70', ...over }));
  const count = (r: Awaited<ReturnType<typeof reader>>, test: (p: number[]) => boolean, x0: number, y0: number, x1: number, y1: number) => {
    let n = 0;
    for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) if (test(r.at(x, y))) n++;
    return n;
  };
  const isWhite = ([r, g, b]: number[]) => r > 235 && g > 235 && b > 235;
  const isDarkText = ([r, g, b]: number[]) => r < 70 && g < 80 && b < 110;

  it('offers five looks and every one keeps the picture size', async () => {
    expect(LAYOUTS).toEqual(['gradient', 'center', 'card', 'band', 'side']);
    for (const layout of LAYOUTS) expect((await draw(layout)).info, layout).toMatchObject({ width: 800, height: 1000 });
  });

  it('centre: veils the whole picture and puts white words in the middle', async () => {
    const r = await draw('center');
    expect(brightness(r.at(20, 20))).toBeLessThan(140); // corners are veiled, unlike the pale picture
    expect(brightness(r.at(780, 980))).toBeLessThan(140);
    expect(count(r, isWhite, 60, 380, 740, 620)).toBeGreaterThan(150); // the headline sits about mid-height
  });

  it('card: a light card carries dark words, and the picture stays visible around it', async () => {
    const r = await draw('card', { background: new Uint8Array(await sharp({ create: { width: 800, height: 1000, channels: 3, background: '#2A4A6B' } }).webp().toBuffer()) });
    expect(brightness(r.at(400, 20))).toBeLessThan(80); // untouched dark picture above the card
    expect(count(r, (p) => brightness(p) > 235, 60, 700, 740, 960)).toBeGreaterThan(300); // the card itself is light
    expect(count(r, isDarkText, 60, 700, 740, 960)).toBeGreaterThan(80); // and its words are dark
  });

  it('band: a solid strip in a darkened brand colour, flush with the chosen edge', async () => {
    const bottom = await draw('band');
    const [r, g, b] = bottom.at(10, 995);
    expect(g).toBeGreaterThan(r + 20); // a deep green, from #1F8A70 darkened
    expect(g).toBeLessThan(130);
    expect(brightness(bottom.at(10, 20))).toBeGreaterThan(215); // the top is the untouched picture
    const top = await draw('band', { textPosition: 'top' });
    expect(top.at(10, 4)[1]).toBeGreaterThan(top.at(10, 4)[0] + 20);
    expect(brightness(top.at(10, 995))).toBeGreaterThan(215);
  });

  it('side: a dark panel on the left fading out, the right stays as it was', async () => {
    const r = await draw('side');
    expect(brightness(r.at(5, 500))).toBeLessThan(70);
    expect(brightness(r.at(790, 500))).toBeGreaterThan(215);
    expect(count(r, isWhite, 40, 300, 460, 700)).toBeGreaterThan(150);
  });

  it('puts the logo where it cannot meet the words for each look', () => {
    expect(logoCorner('bottom_left', 'bottom', 'side')).toBe('bottom_right');
    expect(logoCorner('top_left', 'bottom', 'side')).toBe('top_right');
    expect(logoCorner('bottom_right', 'bottom', 'center')).toBe('bottom_right');
    expect(logoCorner('bottom_right', 'bottom', 'card')).toBe('top_right');
    expect(logoCorner('top_left', 'top', 'band')).toBe('bottom_left');
  });

  it('draws the logo for every look', async () => {
    for (const layout of LAYOUTS) {
      const r = await reader(await renderPoster({ background: new Uint8Array(await pale()), logo: new Uint8Array(await logo()), text, priceLine: null, layout, textPosition: 'bottom', corner: 'top_right' }));
      let red = 0;
      for (let y = 10; y < 180; y += 3) for (let x = 520; x < 800; x += 3) if (r.at(x, y)[0] > 200 && r.at(x, y)[1] < 60) red++;
      expect(red, layout).toBeGreaterThan(10);
    }
  });

  it('keeps long words and many lines inside the picture in every look', async () => {
    for (const layout of LAYOUTS) {
      const out = await renderPoster({ background: new Uint8Array(await pale()), logo: null, text: { headline: 'Superkalifragilistikekspialidosiusuperpanjang '.repeat(3), subheadline: 'kata '.repeat(60), cta: 'Ajakan yang sangat panjang sekali untuk tombol' }, priceLine: 'Mulai dari Rp 1.450.000.000 per bulan untuk semua paket', layout, textPosition: 'top', corner: 'bottom_right' });
      expect((await sharp(out).metadata()).height, layout).toBe(1000);
    }
  });

  it('tells the model which part to keep calm for each look', () => {
    expect(spaceFor('gradient', 'top')).toBe('top');
    expect(spaceFor('card', 'bottom')).toBe('bottom');
    expect(spaceFor('band', 'top')).toBe('top');
    expect(spaceFor('center', 'bottom')).toBe('center');
    expect(spaceFor('side', 'top')).toBe('left');
    expect(promptWriterInstructions('left')).toMatch(/left 60%/);
    expect(promptWriterInstructions('center')).toMatch(/whole picture soft/);
    expect(promptWriterInstructions('top')).toMatch(/top 40%/);
    expect(fallbackImagePrompt({ name: 'A', packages: [] }, { brandName: 'B' }, 'promo', null, 'left')).toMatch(/left 60%/);
    for (const space of ['top', 'bottom', 'left', 'center'] as const) expect(promptWriterInstructions(space)).toMatch(/No text, letters/);
  });

  it('treats a poster saved before the looks existed as the fade', () => {
    expect(posterCopySchema.parse({ headline: 'Halo', subheadline: null, cta: null, showPrice: false, textPosition: 'bottom', logo: true, corner: 'bottom_right' }).layout).toBe('gradient');
    expect(posterCopySchema.safeParse({ headline: 'Halo', layout: 'spiral' }).success).toBe(false);
  });
});
