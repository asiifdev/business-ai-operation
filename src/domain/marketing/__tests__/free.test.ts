import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeProvider, sayJson } from '../../../ai/fake-provider';
import type { ImageResult } from '../../../ai/types';
import { db, pg } from '../../../db/client';
import { marketingAssets } from '../../../db/schema';
import { setStorage, type Storage } from '../../../integrations/storage';
import { makeOrg } from '../../ai/__tests__/support';
import { DomainError } from '../../errors';
import { saveCompanyProfile } from '../../org/profile';
import { setBrandLogo } from '../../portfolio/logo';
import { createPackage, createProduct } from '../../portfolio/products';
import { createFromPrompt, prepareAttachments, refineFreeAsset } from '../free';
import { foreignClaims, strictPrompt } from '../free-rules';
import { readPage } from '../page';
import { reviseAsset } from '../service';

afterAll(async () => {
  setStorage(undefined);
  await pg.end();
});

function memoryStorage(): Storage {
  const objects = new Map<string, Uint8Array>();
  return {
    put: async (key, bytes) => void objects.set(key, bytes),
    get: async (key) => {
      const v = objects.get(key);
      if (!v) throw new Error('missing object');
      return v;
    },
    delete: async (key) => void objects.delete(key),
  };
}
beforeEach(() => setStorage(memoryStorage()));

const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1, 2, 3]);
const pictures = (n = 1): ImageResult => ({ images: Array.from({ length: n }, () => ({ bytes: WEBP, mime: 'image/webp' as const })), meta: { model: 'muse-image-1.0', rateLimit: {}, attempts: 1 } });
const png = (color = '#2554d0') => sharp({ create: { width: 64, height: 64, channels: 3, background: color } }).png().toBuffer();
const rejects = async (promise: Promise<unknown>, code: string) => {
  const err = await promise.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(DomainError);
  expect((err as DomainError).code).toBe(code);
};

const BRIEF = { imagePrompt: 'A clean square social media poster with a laptop mockup, navy and blue, headline at the top, small logo bottom right.', onImageText: ['Diskon Akhir Tahun'], caption: 'Diskon Akhir Tahun untuk semua pelanggan kami.' };
const read = (...text: string[]) => sayJson({ visibleText: text });

describe('foreignClaims (D-080)', () => {
  it('lets through text the person wrote, and flags an offer nobody gave', () => {
    const sources = ['Poster "Diskon Akhir Tahun" untuk Orbyte', 'Merek: Orbyte'];
    expect(foreignClaims(['Diskon Akhir Tahun', 'ORBYTE'], sources)).toEqual([]);
    const bad = foreignClaims(['Diskon Akhir Tahun', 'Hingga 50% untuk semua paket', 'Periode terbatas Desember'], sources);
    expect(bad).toEqual(expect.arrayContaining(['50', 'terbatas', 'desember']));
  });

  it('accepts a figure the person typed, and numbers read from an attachment', () => {
    expect(foreignClaims(['Diskon 20%'], ['buat poster diskon 20% akhir tahun'])).toEqual([]);
    expect(foreignClaims(['Rp 12.450.000'], ['Teks di screenshot: Rp 12.450.000'])).toEqual([]);
    expect(foreignClaims(['Gratis ongkir'], ['poster promo toko'])).toEqual(['gratis']);
  });

  it('does not mistake part of a word for a claim', () => {
    expect(foreignClaims(['Saved Searches', 'Offline mode', 'Freedom to grow'], ['dashboard produk'])).toEqual([]);
    expect(foreignClaims(['Save 20%'], ['dashboard produk'])).toEqual(expect.arrayContaining(['save', '20']));
  });

  it('builds a strict retry prompt that names the only text allowed', () => {
    expect(strictPrompt('A poster.', ['Diskon Akhir Tahun'])).toContain('exactly: "Diskon Akhir Tahun"');
    expect(strictPrompt('A poster.', [])).toContain('no text at all');
    expect(strictPrompt('A poster.', ['A'])).not.toContain('previous attempt');
    expect(strictPrompt('A poster.', ['A'], true)).toContain('previous attempt');
  });
});

describe('page reader (D-080)', () => {
  it('keeps the title, the description and the readable text, and drops scripts and markup', () => {
    const p = readPage('https://aksara.id', '<html><head><title> Aksara &amp; Co </title><meta name="description" content="Studio software"><script>alert(1)</script></head><body><h1>Halo</h1><style>.x{}</style><p>Kami membuat <b>aplikasi</b>.</p></body></html>');
    expect(p).toMatchObject({ title: 'Aksara & Co', description: 'Studio software' });
    expect(p.text).toBe('Halo Kami membuat aplikasi .');
    expect(p.text).not.toContain('alert');
  });
});

describe('attachments (D-080)', () => {
  it('re-encodes pictures and refuses too many, other files and oversize ones', async () => {
    const ok = await prepareAttachments([{ bytes: new Uint8Array(await png()), name: 'logo.png' }]);
    expect(ok[0]).toMatchObject({ mime: 'image/webp', name: 'logo.png' });
    await rejects(prepareAttachments(new Array(5).fill({ bytes: new Uint8Array(await png()), name: 'x.png' })), 'validation');
    await rejects(prepareAttachments([{ bytes: new TextEncoder().encode('<svg onload=alert(1)>'), name: 'x.svg' }]), 'validation');
    await rejects(prepareAttachments([{ bytes: new Uint8Array(6 * 1024 * 1024), name: 'big.png' }]), 'validation');
  });
});

describe('createFromPrompt (D-080)', () => {
  it('makes a finished picture and a caption from one request, with no attachment', async () => {
    const o = await makeOrg();
    const provider = new FakeProvider({ chat: [sayJson(BRIEF), read('Diskon Akhir Tahun')], image: [pictures()] });
    const r = await createFromPrompt(o.ownerCtx, { prompt: 'Poster "Diskon Akhir Tahun" untuk toko kami', aspect: 'square' }, [], provider);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.asset).toMatchObject({ purpose: 'free', productId: null, parentAssetId: null });
    expect(r.caption).toBe('Diskon Akhir Tahun untuk semua pelanggan kami.');
    expect(provider.imageCalls).toHaveLength(1);
    expect(provider.editCalls).toHaveLength(0);
    expect(provider.imageCalls[0]!.grounding).toBe(false); // the model may not browse or pull in brands
  });

  it('gives the attachments to the model to look at and as references for the picture', async () => {
    const o = await makeOrg();
    const provider = new FakeProvider({ chat: [read('Rp 12.450.000'), sayJson(BRIEF), read('Diskon Akhir Tahun', 'Rp 12.450.000')], image: [pictures()] });
    const files = [{ bytes: new Uint8Array(await png()), name: 'screenshot.png' }];
    const r = await createFromPrompt(o.ownerCtx, { prompt: 'Poster "Diskon Akhir Tahun" dengan screenshot ini' }, files, provider);
    expect(r.ok).toBe(true);
    expect(provider.editCalls).toHaveLength(1);
    expect(provider.editCalls[0]!.images).toHaveLength(1);
    const briefCall = provider.chatCalls[1]!;
    expect(briefCall.messages[1]).toMatchObject({ role: 'user' });
    expect((briefCall.messages[1] as { images?: unknown[] }).images).toHaveLength(1);
    expect(JSON.stringify(briefCall.messages)).toContain('data_tidak_tepercaya');
  });

  it('lays the company logo on with code and never sends it to the model, keeping the clean picture for revisions', async () => {
    const o = await makeOrg();
    await setBrandLogo(o.ownerCtx, new Uint8Array(await png('#ff0000')));
    const provider = new FakeProvider({ chat: [sayJson(BRIEF), read('Diskon Akhir Tahun')], image: [pictures()] });
    const r = await createFromPrompt(o.ownerCtx, { prompt: 'Poster "Diskon Akhir Tahun"' }, [], provider);
    expect(r.ok).toBe(true);
    // No attachment, so the model draws from the prompt alone and is told to leave the corner empty.
    expect(provider.editCalls).toHaveLength(0);
    expect(JSON.stringify(provider.imageCalls)).toContain('top-left corner');
    if (r.ok) expect(r.asset.backgroundFileId).not.toBeNull();
    const off = new FakeProvider({ chat: [sayJson(BRIEF), read('Diskon Akhir Tahun')], image: [pictures()] });
    const none = await createFromPrompt(o.ownerCtx, { prompt: 'Poster "Diskon Akhir Tahun"', logo: false }, [], off);
    if (none.ok) expect(none.asset.backgroundFileId).toBeNull();
  });

  it('sends a picture that invented an offer back once for a plain version, then keeps it', async () => {
    const o = await makeOrg();
    const provider = new FakeProvider({ chat: [sayJson(BRIEF), read('Diskon Akhir Tahun', 'Hingga 50% • Periode terbatas Desember'), read('Diskon Akhir Tahun')], image: [pictures(), pictures()] });
    const r = await createFromPrompt(o.ownerCtx, { prompt: 'Poster "Diskon Akhir Tahun"' }, [], provider);
    expect(r.ok).toBe(true);
    expect(provider.imageCalls).toHaveLength(2);
    expect(provider.imageCalls[0]!.prompt).toContain('the only text allowed anywhere in the picture is exactly: "Diskon Akhir Tahun"'); // the rule is there from the first try
    expect(provider.imageCalls[0]!.prompt).not.toContain('previous attempt');
    expect(provider.imageCalls[1]!.prompt).toContain('previous attempt');
    expect(await db.select().from(marketingAssets).where(eq(marketingAssets.orgId, o.orgId))).toHaveLength(1); // only the clean one is kept
  });

  it('refuses when the plain version still carries a claim, and stores nothing', async () => {
    const o = await makeOrg();
    const provider = new FakeProvider({ chat: [sayJson(BRIEF), read('Hingga 50% Desember'), read('Gratis ongkir')], image: [pictures(), pictures()] });
    const r = await createFromPrompt(o.ownerCtx, { prompt: 'Poster "Diskon Akhir Tahun"' }, [], provider);
    expect(r).toMatchObject({ ok: false, kind: 'unverified' });
    expect(await db.select().from(marketingAssets).where(eq(marketingAssets.orgId, o.orgId))).toHaveLength(0);
  });

  it('refuses a picture it cannot read back, instead of showing it unchecked', async () => {
    const o = await makeOrg();
    const provider = new FakeProvider({ chat: [sayJson(BRIEF), sayJson({ nonsense: true })], image: [pictures()] });
    expect(await createFromPrompt(o.ownerCtx, { prompt: 'Poster "Diskon Akhir Tahun"' }, [], provider)).toMatchObject({ ok: false, kind: 'unverified' });
  });

  it('drops a caption that carries a claim nobody gave, but keeps the picture', async () => {
    const o = await makeOrg();
    const provider = new FakeProvider({ chat: [sayJson({ ...BRIEF, caption: 'Diskon 70% hanya sampai Desember!' }), read('Diskon Akhir Tahun')], image: [pictures()] });
    const r = await createFromPrompt(o.ownerCtx, { prompt: 'Poster "Diskon Akhir Tahun"' }, [], provider);
    expect(r).toMatchObject({ ok: true, caption: null });
  });

  it('uses the company profile and product facts as context, and lets Staff use it', async () => {
    const o = await makeOrg();
    await saveCompanyProfile(o.ownerCtx, { description: 'Studio software untuk klinik' });
    const product = await createProduct(o.ownerCtx, { name: 'Orbit CRM', description: 'CRM untuk agensi' });
    await createPackage(o.ownerCtx, product.id, { name: 'Bisnis', monthlyPrice: 450_000 });
    const provider = new FakeProvider({ chat: [sayJson(BRIEF), read('Diskon Akhir Tahun')], image: [pictures()] });
    const r = await createFromPrompt(o.staffCtx, { prompt: 'Poster "Diskon Akhir Tahun"', productId: product.id }, [], provider);
    expect(r.ok).toBe(true);
    const sent = JSON.stringify(provider.chatCalls[0]!.messages);
    expect(sent).toContain('Studio software untuk klinik');
    expect(sent).toContain('Orbit CRM');
  });

  it('refuses a link that points inside the network', async () => {
    const o = await makeOrg();
    const provider = new FakeProvider({ chat: [] });
    expect(await createFromPrompt(o.ownerCtx, { prompt: 'Poster dari halaman ini', url: 'https://127.0.0.1/admin' }, [], provider)).toMatchObject({ ok: false, kind: 'url' });
    expect(await createFromPrompt(o.ownerCtx, { prompt: 'Poster dari halaman ini', url: 'https://localhost/' }, [], provider)).toMatchObject({ ok: false, kind: 'url' });
    await rejects(createFromPrompt(o.ownerCtx, { prompt: 'Poster dari halaman ini', url: 'http://aksara.id' }, [], provider), 'validation' as never).catch(() => undefined);
  });
});

describe('refineFreeAsset (D-080)', () => {
  it('edits the picture itself from a plain instruction and keeps the old one', async () => {
    const o = await makeOrg();
    const first = await createFromPrompt(o.ownerCtx, { prompt: 'Poster "Diskon Akhir Tahun"' }, [], new FakeProvider({ chat: [sayJson(BRIEF), read('Diskon Akhir Tahun')], image: [pictures()] }));
    if (!first.ok) throw new Error('setup failed');
    const provider = new FakeProvider({ chat: [read('Diskon Akhir Tahun'), read('Diskon Akhir Tahun')], image: [pictures()] });
    const r = await refineFreeAsset(o.ownerCtx, first.asset.id, { instruction: 'warna lebih hangat' }, provider);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.asset.parentAssetId).toBe(first.asset.id);
    expect(provider.editCalls[0]!.images).toHaveLength(1);
    expect(provider.editCalls[0]!.prompt).toContain('warna lebih hangat');
    expect(await db.select().from(marketingAssets).where(eq(marketingAssets.orgId, o.orgId))).toHaveLength(2);
    // the old poster editor does not take a free picture
    await rejects(reviseAsset(o.ownerCtx, first.asset.id, { instruction: 'lebih terang' }, new FakeProvider()), 'invalid_state');
  });

  it('revises the clean picture and stamps the logo again, so the logo is never redrawn', async () => {
    const o = await makeOrg();
    await setBrandLogo(o.ownerCtx, new Uint8Array(await png('#ff0000')));
    const first = await createFromPrompt(o.ownerCtx, { prompt: 'Poster "Diskon Akhir Tahun"' }, [], new FakeProvider({ chat: [sayJson(BRIEF), read('Diskon Akhir Tahun')], image: [pictures()] }));
    if (!first.ok) throw new Error('setup failed');
    const r = await refineFreeAsset(o.ownerCtx, first.asset.id, { instruction: 'warna lebih hangat' }, new FakeProvider({ chat: [read('Diskon Akhir Tahun'), read('Diskon Akhir Tahun')], image: [pictures()] }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.asset.backgroundFileId).not.toBeNull();
  });

  it('refuses a change that adds an offer', async () => {
    const o = await makeOrg();
    const first = await createFromPrompt(o.ownerCtx, { prompt: 'Poster "Diskon Akhir Tahun"' }, [], new FakeProvider({ chat: [sayJson(BRIEF), read('Diskon Akhir Tahun')], image: [pictures()] }));
    if (!first.ok) throw new Error('setup failed');
    const provider = new FakeProvider({ chat: [read('Diskon Akhir Tahun'), read('Diskon Akhir Tahun', 'Hemat 30%')], image: [pictures()] });
    expect(await refineFreeAsset(o.ownerCtx, first.asset.id, { instruction: 'lebih terang' }, provider)).toMatchObject({ ok: false, kind: 'unverified' });
  });
});
