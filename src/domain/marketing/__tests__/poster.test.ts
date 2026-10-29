import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { applyLogo } from '../poster';

/** A flat 400x600 picture of one colour, and a solid red logo, so every pixel's origin is known. */
const picture = () => sharp({ create: { width: 400, height: 600, channels: 3, background: '#1F3A5F' } }).webp().toBuffer();
const logo = () => sharp({ create: { width: 200, height: 80, channels: 4, background: '#ff0000' } }).png().toBuffer();

/** Decodes once and answers pixel lookups from memory. */
async function raw(webp: Buffer) {
  const { data, info } = await sharp(webp).raw().toBuffer({ resolveWithObject: true });
  return (x: number, y: number) => {
    const i = (y * info.width + x) * info.channels;
    return [data[i], data[i + 1], data[i + 2]];
  };
}
const isRed = ([r, g, b]: number[]) => r > 200 && g < 60 && b < 60;
const isNavy = ([r, g, b]: number[]) => Math.abs(r - 0x1f) < 14 && Math.abs(g - 0x3a) < 14 && Math.abs(b - 0x5f) < 14;

describe('D-066 logo on a poster', () => {
  it('keeps the picture size and puts the real logo in the chosen corner only', async () => {
    const base = await picture();
    for (const [corner, probe, empty] of [
      ['bottom_right', [340, 560], [60, 60]],
      ['bottom_left', [60, 560], [340, 60]],
      ['top_right', [340, 40], [60, 560]],
      ['top_left', [60, 40], [340, 560]],
    ] as const) {
      const out = await applyLogo(new Uint8Array(base), new Uint8Array(await logo()), corner);
      const meta = await sharp(out).metadata();
      expect([meta.width, meta.height, meta.format]).toEqual([400, 600, 'webp']);
      // The logo is red; somewhere inside the corner region there are red pixels, and the opposite corner is untouched.
      const at = await raw(out);
      let red = 0;
      for (let dx = -45; dx <= 45; dx += 3) for (let dy = -20; dy <= 20; dy += 3) if (isRed(at(probe[0] + dx, probe[1] + dy))) red++;
      expect(red, corner).toBeGreaterThan(5);
      expect(isNavy(at(empty[0], empty[1])), `${corner} opposite corner`).toBe(true);
    }
  });

  it('sits on a light plate so a dark picture does not swallow it', async () => {
    const out = await applyLogo(new Uint8Array(await picture()), new Uint8Array(await logo()), 'bottom_right');
    const [r, g, b] = (await raw(out))(279, 559); // inside the plate's padding, left of and above the logo
    expect(Math.min(r, g, b)).toBeGreaterThan(150);
  });

  it('keeps a logo no larger than a quarter of the picture width', async () => {
    const wide = await sharp({ create: { width: 3000, height: 100, channels: 4, background: '#00ff00' } }).png().toBuffer();
    const out = await applyLogo(new Uint8Array(await picture()), new Uint8Array(wide), 'top_left');
    const at = await raw(out);
    let greenColumns = 0;
    for (let x = 0; x < 400; x += 2) if (at(x, 30)[1] > 200 && at(x, 30)[0] < 80) greenColumns++;
    expect(greenColumns * 2).toBeLessThanOrEqual(400 * 0.26);
  });

  it('refuses something that is not a picture instead of returning garbage', async () => {
    await expect(applyLogo(new Uint8Array(await picture()), new Uint8Array([1, 2, 3]), 'top_left')).rejects.toThrow();
  });
});
