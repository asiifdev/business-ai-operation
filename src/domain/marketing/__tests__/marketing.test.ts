import { and, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { AiProviderError } from '../../../ai/errors';
import { FakeProvider, say, sayJson } from '../../../ai/fake-provider';
import type { ImageResult } from '../../../ai/types';
import { db, pg } from '../../../db/client';
import sharp from 'sharp';
import { aiRuns, auditLog, files, marketingAssets } from '../../../db/schema';
import { removeBrandLogo, setBrandLogo, setProductLogo } from '../../portfolio/logo';
import { setStorage, type Storage } from '../../../integrations/storage';
import { makeOrg } from '../../ai/__tests__/support';
import { DomainError } from '../../errors';
import { createPackage, createProduct, updatePackage } from '../../portfolio/products';
import { deleteAsset, draftCaption, generateAssets, getBrandKit, imageQuotaStatus, listAssets, readAssetFile, readAssetLogo, reviseAsset, saveBrandKit, updateCaption, updatePosterCopy } from '../service';

afterAll(async () => {
  setStorage(undefined);
  await pg.end();
});

function memoryStorage(): Storage & { keys: () => string[] } {
  const objects = new Map<string, Uint8Array>();
  return {
    put: async (key, bytes) => void objects.set(key, bytes),
    get: async (key) => {
      const v = objects.get(key);
      if (!v) throw new Error('missing object');
      return v;
    },
    delete: async (key) => void objects.delete(key),
    keys: () => [...objects.keys()],
  };
}
let store: ReturnType<typeof memoryStorage>;
beforeEach(() => {
  store = memoryStorage();
  setStorage(store);
});

const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1, 2, 3]);
const pictures = (n: number): ImageResult => ({ images: Array.from({ length: n }, () => ({ bytes: WEBP, mime: 'image/webp' as const })), meta: { model: 'muse-image-1.0', rateLimit: {}, attempts: 1 } });
const PROMPT = 'A calm desk scene with a laptop showing a dashboard, warm cream and navy palette, soft morning light, clean space for a caption.';

async function seed() {
  const o = await makeOrg();
  const product = await createProduct(o.ownerCtx, { name: 'Orbit CRM', description: 'CRM untuk agensi kecil' });
  const pkg = await createPackage(o.ownerCtx, product.id, { name: 'Bisnis', monthlyPrice: 450_000 });
  return { o, productId: product.id, packageId: pkg.id };
}
const rejects = async (promise: Promise<unknown>, code: string) => {
  const err = await promise.then(() => null, (e: unknown) => e);
  expect(err, `expected DomainError ${code}`).toBeInstanceOf(DomainError);
  expect((err as DomainError).code).toBe(code);
};

describe('M10 marketing studio', () => {
  it('makes images from product facts, stores them as AI-marked files, and writes an audit row', async () => {
    const s = await seed();
    await saveBrandKit(s.o.ownerCtx, { brandName: 'Aksara', colors: '#1F3A5F', tone: 'ramah' });
    const provider = new FakeProvider({ chat: [say(PROMPT)], image: [pictures(2)] });
    const r = await generateAssets(s.o.staffCtx, { withText: false, productId: s.productId, purpose: 'launch', variants: 2 }, provider);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.assets).toHaveLength(2);

    // The prompt writer saw the facts and the brand; the image call got its answer, grounding off (nothing from the web).
    const sent = JSON.stringify(provider.chatCalls[0].messages);
    expect(sent).toContain('Orbit CRM');
    expect(sent).toContain('Rp 450.000');
    expect(sent).toContain('Aksara');
    expect(provider.imageCalls[0]).toMatchObject({ prompt: PROMPT, n: 2, grounding: false });
    // Meta rejects a chat call under 1000 output tokens (reasoning shares the budget); a fake never would.
    expect(provider.chatCalls[0].maxTokens).toBeGreaterThanOrEqual(1000);

    const [file] = await db.select().from(files).where(eq(files.id, r.assets[0].fileId));
    expect(file).toMatchObject({ kind: 'marketing_image', isAiGenerated: true, mime: 'image/webp', orgId: s.o.orgId });
    expect(store.keys()).toContain(file.storageKey);
    const audit = await db.select().from(auditLog).where(and(eq(auditLog.orgId, s.o.orgId), eq(auditLog.action, 'marketing_asset.generated')));
    expect(audit).toHaveLength(2);
    expect((await listAssets(s.o.staffCtx)).map((a) => a.productName)).toEqual(['Orbit CRM', 'Orbit CRM']);
  });

  it('falls back to a prompt built from the facts when the model cannot write one', async () => {
    const s = await seed();
    const provider = new FakeProvider({ chat: [new AiProviderError('unavailable', 'down')], image: [pictures(1)] });
    const r = await generateAssets(s.o.ownerCtx, { withText: false, productId: s.productId, purpose: 'promo' }, provider);
    expect(r.ok).toBe(true);
    expect(provider.imageCalls[0].prompt).toContain('Orbit CRM');
    expect(provider.imageCalls[0].prompt).toMatch(/No text, letters/);
  });

  it('a safety-filter refusal is a plain message, saves nothing, and uses no quota (BR-M10-08)', async () => {
    const s = await seed();
    const provider = new FakeProvider({ chat: [say(PROMPT)], image: [new AiProviderError('content_policy', 'blocked')] });
    const r = await generateAssets(s.o.ownerCtx, { withText: false, productId: s.productId, purpose: 'promo' }, provider);
    expect(r).toMatchObject({ ok: false, kind: 'content_policy' });
    expect(await listAssets(s.o.ownerCtx)).toHaveLength(0);
    expect(store.keys()).toHaveLength(0);
    expect((await imageQuotaStatus(s.o.ownerCtx)).used).toBe(0);
  });

  it('blocks before any call when the daily quota would be passed (BR-M10-06)', async () => {
    const s = await seed();
    process.env.MARKETING_DAILY_IMAGE_QUOTA = '2';
    try {
      const provider = new FakeProvider({ chat: [say(PROMPT)], image: [pictures(2)] });
      expect((await generateAssets(s.o.ownerCtx, { withText: false, productId: s.productId, purpose: 'launch', variants: 2 }, provider)).ok).toBe(true);
      const blocked = new FakeProvider();
      const r = await generateAssets(s.o.ownerCtx, { withText: false, productId: s.productId, purpose: 'launch' }, blocked);
      expect(r).toMatchObject({ ok: false, kind: 'quota' });
      expect(blocked.chatCalls).toHaveLength(0);
      expect(blocked.imageCalls).toHaveLength(0);
      expect(await imageQuotaStatus(s.o.ownerCtx)).toMatchObject({ quota: 2, used: 2, remaining: 0 });
    } finally {
      delete process.env.MARKETING_DAILY_IMAGE_QUOTA;
    }
  });

  it('blocks when the daily AI budget for images is spent, and records the blocked run', async () => {
    const s = await seed();
    await db.execute(`update ai_budgets set daily_limit_micro_usd = 0 where org_id = '${s.o.orgId}' and feature = 'image'` as never);
    const provider = new FakeProvider({ chat: [say(PROMPT)] });
    const r = await generateAssets(s.o.ownerCtx, { withText: false, productId: s.productId, purpose: 'launch' }, provider);
    expect(r).toMatchObject({ ok: false, kind: 'budget' });
    const runs = await db.select().from(aiRuns).where(and(eq(aiRuns.orgId, s.o.orgId), eq(aiRuns.feature, 'image')));
    expect(runs.map((x) => x.status)).toEqual(['blocked_budget']);
  });

  it('a revision is a new image that points at the old one, which stays (BRD-M10 section 10)', async () => {
    const s = await seed();
    const first = await generateAssets(s.o.ownerCtx, { withText: false, productId: s.productId, purpose: 'launch' }, new FakeProvider({ chat: [say(PROMPT)], image: [pictures(1)] }));
    if (!first.ok) throw new Error('setup');
    const provider = new FakeProvider({ image: [pictures(1)] });
    const rev = await reviseAsset(s.o.ownerCtx, first.assets[0].id, { instruction: 'buat lebih terang' }, provider);
    if (!rev.ok) throw new Error('revision failed');
    expect(rev.assets[0].parentAssetId).toBe(first.assets[0].id);
    expect(provider.imageCalls[0].prompt).toContain(PROMPT);
    expect(provider.imageCalls[0].prompt).toContain('buat lebih terang');
    expect(await listAssets(s.o.ownerCtx)).toHaveLength(2);
  });

  it('keeps a caption that quotes the official price and discards one with an invented figure (BR-M10-01, -02)', async () => {
    const s = await seed();
    const made = await generateAssets(s.o.ownerCtx, { withText: false, productId: s.productId, purpose: 'promo' }, new FakeProvider({ chat: [say(PROMPT)], image: [pictures(1)] }));
    if (!made.ok) throw new Error('setup');
    const id = made.assets[0].id;

    const captionProvider = new FakeProvider({ chat: [say('Orbit CRM paket Bisnis Rp 450.000 per bulan. Coba sekarang!')] });
    const good = await draftCaption(s.o.ownerCtx, id, captionProvider);
    expect(good).toMatchObject({ ok: true });
    expect(captionProvider.chatCalls[0].maxTokens).toBeGreaterThanOrEqual(1000);
    const bad = await draftCaption(s.o.ownerCtx, id, new FakeProvider({ chat: [say('Diskon 40%! Hanya Rp 99.000 dan dipercaya 3.000 agensi.')] }));
    expect(bad).toMatchObject({ ok: false, kind: 'foreign_figures' });
    expect((await listAssets(s.o.ownerCtx))[0].caption).toBe('Orbit CRM paket Bisnis Rp 450.000 per bulan. Coba sekarang!');
  });

  it('a later price change is what the next caption is checked against (price comes from the package, not the model)', async () => {
    const s = await seed();
    const made = await generateAssets(s.o.ownerCtx, { withText: false, productId: s.productId, purpose: 'promo' }, new FakeProvider({ chat: [say(PROMPT)], image: [pictures(1)] }));
    if (!made.ok) throw new Error('setup');
    await updatePackage(s.o.ownerCtx, s.packageId, { monthlyPrice: 500_000 });
    const stale = await draftCaption(s.o.ownerCtx, made.assets[0].id, new FakeProvider({ chat: [say('Paket Bisnis Rp 450.000 per bulan.')] }));
    expect(stale).toMatchObject({ ok: false, kind: 'foreign_figures' });
  });

  it('only Owner and Admin edit the brand kit; everyone can read it (BR-M10-11)', async () => {
    const s = await seed();
    await rejects(saveBrandKit(s.o.staffCtx, { brandName: 'Aksara' }), 'forbidden');
    await saveBrandKit(s.o.adminCtx, { brandName: 'Aksara', tone: 'ramah' });
    expect((await getBrandKit(s.o.staffCtx))?.brandName).toBe('Aksara');
    await saveBrandKit(s.o.ownerCtx, { brandName: 'Aksara Baru' });
    expect((await getBrandKit(s.o.staffCtx))?.brandName).toBe('Aksara Baru');
    const audit = await db.select().from(auditLog).where(and(eq(auditLog.orgId, s.o.orgId), eq(auditLog.action, 'brand_kit.saved')));
    expect(audit).toHaveLength(2); // Admin and Owner saved; Staff was refused and left no row
  });

  it('Staff delete only their own assets; Admin delete any; the picture leaves storage; revisions stay', async () => {
    const s = await seed();
    const mine = await generateAssets(s.o.staffCtx, { withText: false, productId: s.productId, purpose: 'launch' }, new FakeProvider({ chat: [say(PROMPT)], image: [pictures(1)] }));
    const theirs = await generateAssets(s.o.ownerCtx, { withText: false, productId: s.productId, purpose: 'launch' }, new FakeProvider({ chat: [say(PROMPT)], image: [pictures(1)] }));
    if (!mine.ok || !theirs.ok) throw new Error('setup');
    await rejects(deleteAsset(s.o.staffCtx, theirs.assets[0].id), 'forbidden');

    const rev = await reviseAsset(s.o.ownerCtx, mine.assets[0].id, { instruction: 'lebih cerah' }, new FakeProvider({ image: [pictures(1)] }));
    if (!rev.ok) throw new Error('setup');
    await deleteAsset(s.o.staffCtx, mine.assets[0].id);
    const left = await listAssets(s.o.ownerCtx);
    expect(left).toHaveLength(2);
    expect(left.find((a) => a.id === rev.assets[0].id)?.parentAssetId).toBeNull();
    expect(store.keys()).toHaveLength(2);
    await deleteAsset(s.o.adminCtx, theirs.assets[0].id);
    expect(store.keys()).toHaveLength(1);
  });

  it('another organization cannot see, download, revise or caption an asset', async () => {
    const s = await seed();
    const other = await makeOrg();
    const made = await generateAssets(s.o.ownerCtx, { withText: false, productId: s.productId, purpose: 'launch' }, new FakeProvider({ chat: [say(PROMPT)], image: [pictures(1)] }));
    if (!made.ok) throw new Error('setup');
    const id = made.assets[0].id;
    await rejects(readAssetFile(other.ownerCtx, id), 'not_found');
    await rejects(reviseAsset(other.ownerCtx, id, { instruction: 'lebih cerah' }, new FakeProvider()), 'not_found');
    await rejects(updateCaption(other.ownerCtx, id, { caption: 'x' }), 'not_found');
    await rejects(deleteAsset(other.ownerCtx, id), 'not_found');
    await rejects(generateAssets(other.ownerCtx, { withText: false, productId: s.productId, purpose: 'launch' }, new FakeProvider()), 'not_found');
    expect(await listAssets(other.ownerCtx)).toHaveLength(0);
    expect((await readAssetFile(s.o.ownerCtx, id)).bytes).toEqual(WEBP);
  });

  it('the database refuses an asset that points at another organization\'s file', async () => {
    const s = await seed();
    const other = await makeOrg();
    const made = await generateAssets(other.ownerCtx, { withText: false, productId: (await createProduct(other.ownerCtx, { name: 'Lain' })).id, purpose: 'launch' }, new FakeProvider({ chat: [say(PROMPT)], image: [pictures(1)] }));
    if (!made.ok) throw new Error('setup');
    const err = await db.insert(marketingAssets).values({ orgId: s.o.orgId, productId: s.productId, purpose: 'launch', prompt: 'x', fileId: made.assets[0].fileId, createdBy: s.o.ownerCtx.userId }).then(() => null, (e: unknown) => e);
    expect(err).not.toBeNull();
  });

  // ---------------------------------------------------------------------------------------------------------------------
  // D-066: company level marketing and the real logo on every poster
  // ---------------------------------------------------------------------------------------------------------------------
  const realPicture = async (): Promise<ImageResult> => ({ images: [{ bytes: new Uint8Array(await sharp({ create: { width: 400, height: 600, channels: 3, background: '#1F3A5F' } }).webp().toBuffer()), mime: 'image/webp' as const }], meta: { model: 'muse-image-1.0', rateLimit: {}, attempts: 1 } });
  const logoPng = (colour: string) => sharp({ create: { width: 200, height: 80, channels: 4, background: colour } }).png().toBuffer();
  const cornerIs = async (assetId: string, ctx: Awaited<ReturnType<typeof seed>>['o']['ownerCtx'], colour: 'red' | 'green' | 'none') => {
    const { data, info } = await sharp((await readAssetFile(ctx, assetId)).bytes).raw().toBuffer({ resolveWithObject: true });
    let found = 0;
    for (let y = 500; y < 580; y += 4) for (let x = 300; x < 380; x += 4) {
      const i = (y * info.width + x) * info.channels;
      if (colour === 'red' && data[i] > 200 && data[i + 1] < 60) found++;
      if (colour === 'green' && data[i + 1] > 200 && data[i] < 60) found++;
    }
    return colour === 'none' ? found === 0 : found > 3;
  };

  it('makes company level content with no product, using facts without any price', async () => {
    const s = await seed();
    await saveBrandKit(s.o.ownerCtx, { brandName: 'Aksara Studio', tone: 'ramah' });
    const provider = new FakeProvider({ chat: [say(PROMPT)], image: [pictures(1)] });
    const r = await generateAssets(s.o.ownerCtx, { withText: false, productId: null, purpose: 'brand' }, provider);
    if (!r.ok) throw new Error('company poster failed');
    expect(r.assets[0]).toMatchObject({ productId: null, purpose: 'brand' });

    const sent = JSON.stringify(provider.chatCalls[0].messages);
    expect(sent).toContain('Aksara Studio');
    expect(sent).toContain('Orbit CRM'); // its product is named as something the company offers
    expect(sent).not.toContain('450'); // but its price is never offered to the model
    expect(provider.imageCalls[0].prompt).toBe(PROMPT);

    const listed = await listAssets(s.o.ownerCtx, { company: true });
    expect(listed).toHaveLength(1);
    expect(listed[0].productName).toBeNull();
    expect(await listAssets(s.o.ownerCtx, { productId: s.productId })).toHaveLength(0);
  });

  it('a company caption may not carry a price or any figure, and a clean one is kept', async () => {
    const s = await seed();
    const made = await generateAssets(s.o.ownerCtx, { withText: false, productId: null, purpose: 'brand' }, new FakeProvider({ chat: [say(PROMPT)], image: [pictures(1)] }));
    if (!made.ok) throw new Error('setup');
    const id = made.assets[0].id;
    const withPrice = await draftCaption(s.o.ownerCtx, id, new FakeProvider({ chat: [say('Mulai dari Rp 450.000 per bulan!')] }));
    expect(withPrice).toMatchObject({ ok: false, kind: 'foreign_figures' });
    const clean = new FakeProvider({ chat: [say('Aksara Studio membantu agensi kecil bekerja lebih rapi.')] });
    expect(await draftCaption(s.o.ownerCtx, id, clean)).toMatchObject({ ok: true });
    expect(JSON.stringify(clean.chatCalls[0].messages)).toMatch(/Jangan menyebut harga/);
  });

  it('lays the company logo on a poster, and the picture is otherwise what the model made', async () => {
    const s = await seed();
    await saveBrandKit(s.o.ownerCtx, { brandName: 'Aksara Studio' });
    await setBrandLogo(s.o.ownerCtx, new Uint8Array(await logoPng('#ff0000')));
    const r = await generateAssets(s.o.ownerCtx, { withText: false, productId: null, purpose: 'brand' }, new FakeProvider({ chat: [say(PROMPT)], image: [await realPicture()] }));
    if (!r.ok) throw new Error('poster failed');
    expect(await cornerIs(r.assets[0].id, s.o.ownerCtx, 'red')).toBe(true);
    expect((await readAssetLogo(s.o.ownerCtx, r.assets[0].id)).mime).toBe('image/webp');
    expect((await listAssets(s.o.ownerCtx))[0].hasLogo).toBe(true);
  });

  it('a product poster uses the product logo before the company logo, and the company logo when the product has none', async () => {
    const s = await seed();
    await saveBrandKit(s.o.ownerCtx, { brandName: 'Aksara Studio' });
    await setBrandLogo(s.o.ownerCtx, new Uint8Array(await logoPng('#ff0000')));
    const other = await createProduct(s.o.ownerCtx, { name: 'Orbit Chat' });
    await setProductLogo(s.o.ownerCtx, other.id, new Uint8Array(await logoPng('#00ff00')));

    const own = await generateAssets(s.o.ownerCtx, { withText: false, productId: other.id, purpose: 'launch' }, new FakeProvider({ chat: [say(PROMPT)], image: [await realPicture()] }));
    const fallback = await generateAssets(s.o.ownerCtx, { withText: false, productId: s.productId, purpose: 'launch' }, new FakeProvider({ chat: [say(PROMPT)], image: [await realPicture()] }));
    if (!own.ok || !fallback.ok) throw new Error('setup');
    expect(await cornerIs(own.assets[0].id, s.o.ownerCtx, 'green')).toBe(true);
    expect(await cornerIs(fallback.assets[0].id, s.o.ownerCtx, 'red')).toBe(true);
  });

  it('leaves the picture plain when asked to, when there is no logo, and puts the logo back on a revision', async () => {
    const s = await seed();
    const noLogo = await generateAssets(s.o.ownerCtx, { withText: false, productId: s.productId, purpose: 'launch' }, new FakeProvider({ chat: [say(PROMPT)], image: [await realPicture()] }));
    if (!noLogo.ok) throw new Error('setup');
    expect(await cornerIs(noLogo.assets[0].id, s.o.ownerCtx, 'none')).toBe(true);
    expect((await listAssets(s.o.ownerCtx))[0].hasLogo).toBe(false);
    await expect(readAssetLogo(s.o.ownerCtx, noLogo.assets[0].id)).rejects.toThrow();

    await saveBrandKit(s.o.ownerCtx, { brandName: 'Aksara Studio' });
    await setBrandLogo(s.o.ownerCtx, new Uint8Array(await logoPng('#ff0000')));
    const off = await generateAssets(s.o.ownerCtx, { withText: false, productId: s.productId, purpose: 'launch', logo: false }, new FakeProvider({ chat: [say(PROMPT)], image: [await realPicture()] }));
    if (!off.ok) throw new Error('setup');
    expect(await cornerIs(off.assets[0].id, s.o.ownerCtx, 'none')).toBe(true);

    const rev = await reviseAsset(s.o.ownerCtx, noLogo.assets[0].id, { instruction: 'lebih terang' }, new FakeProvider({ image: [await realPicture()] }));
    if (!rev.ok) throw new Error('revision failed');
    expect(await cornerIs(rev.assets[0].id, s.o.ownerCtx, 'red')).toBe(true);
  });

  it('a logo that cannot be read does not lose the poster', async () => {
    const s = await seed();
    await saveBrandKit(s.o.ownerCtx, { brandName: 'Aksara Studio' });
    await setBrandLogo(s.o.ownerCtx, new Uint8Array(await logoPng('#ff0000')));
    const [file] = await db.select().from(files).where(and(eq(files.orgId, s.o.orgId), eq(files.kind, 'brand_logo')));
    await store.put(file.storageKey, new Uint8Array([1, 2, 3]), 'image/webp'); // the stored logo is now garbage
    const r = await generateAssets(s.o.ownerCtx, { withText: false, productId: null, purpose: 'brand' }, new FakeProvider({ chat: [say(PROMPT)], image: [await realPicture()] }));
    expect(r.ok).toBe(true);
  });

  it('the company logo needs a saved brand kit, is for Owner and Admin, and replacing or removing it cleans storage', async () => {
    const s = await seed();
    const png = new Uint8Array(await logoPng('#ff0000'));
    await rejects(setBrandLogo(s.o.ownerCtx, png), 'invalid_state'); // no brand kit yet
    await saveBrandKit(s.o.ownerCtx, { brandName: 'Aksara Studio' });
    await rejects(setBrandLogo(s.o.staffCtx, png), 'forbidden');
    await setBrandLogo(s.o.adminCtx, png);
    await setBrandLogo(s.o.ownerCtx, new Uint8Array(await logoPng('#00ff00')));
    expect(store.keys().filter((k) => k.includes('/brand/'))).toHaveLength(1);
    expect(await db.select().from(files).where(and(eq(files.orgId, s.o.orgId), eq(files.kind, 'brand_logo')))).toHaveLength(1);
    await removeBrandLogo(s.o.ownerCtx);
    expect(store.keys().filter((k) => k.includes('/brand/'))).toHaveLength(0);
    expect((await getBrandKit(s.o.ownerCtx))?.logoFileId).toBeNull();
  });

  it('another organization never gets this organization\'s logo on its poster', async () => {
    const a = await seed();
    const b = await seed();
    await saveBrandKit(a.o.ownerCtx, { brandName: 'Aksara A' });
    await setBrandLogo(a.o.ownerCtx, new Uint8Array(await logoPng('#ff0000')));
    const r = await generateAssets(b.o.ownerCtx, { withText: false, productId: null, purpose: 'brand' }, new FakeProvider({ chat: [say(PROMPT)], image: [await realPicture()] }));
    if (!r.ok) throw new Error('setup');
    expect(await cornerIs(r.assets[0].id, b.o.ownerCtx, 'none')).toBe(true);
  });

  // ---------------------------------------------------------------------------------------------------------------------
  // D-067: poster text drawn by code
  // ---------------------------------------------------------------------------------------------------------------------
  const COPY = { headline: 'Kelola sewa lebih rapi', subheadline: 'Stok dan jadwal dalam satu aplikasi.', cta: 'Coba sekarang' };
  const posterProvider = async (copy: unknown = COPY) => new FakeProvider({ chat: [say(PROMPT), sayJson(copy)], image: [await realPicture()] });
  const makePoster = async (s: Awaited<ReturnType<typeof seed>>, copy?: unknown, extra: Record<string, unknown> = {}) => {
    const r = await generateAssets(s.o.ownerCtx, { productId: s.productId, purpose: 'launch', ...extra } as never, await posterProvider(copy));
    if (!r.ok) throw new Error(`poster failed: ${r.message}`);
    return r.assets[0];
  };
  const bytesOf = async (fileId: string) => {
    const [f] = await db.select().from(files).where(eq(files.id, fileId));
    return store.get(f.storageKey);
  };

  it('draws the model\'s words on the picture and keeps the plain background beside it', async () => {
    const s = await seed();
    const asset = await makePoster(s);
    expect(asset.posterCopy).toMatchObject({ headline: 'Kelola sewa lebih rapi', cta: 'Coba sekarang', showPrice: false, textPosition: 'bottom' });
    expect(asset.backgroundFileId).not.toBeNull();
    const [poster, background] = await Promise.all([bytesOf(asset.fileId), bytesOf(asset.backgroundFileId!)]);
    expect(Buffer.compare(Buffer.from(poster), Buffer.from(background))).not.toBe(0);
    // The bottom edge of the poster is darkened for the text; the plain background is not.
    const edge = async (b: Uint8Array) => { const { data, info } = await sharp(b).raw().toBuffer({ resolveWithObject: true }); const i = ((info.height - 4) * info.width + 4) * info.channels; return (data[i] + data[i + 1] + data[i + 2]) / 3; };
    expect(await edge(poster)).toBeLessThan((await edge(background)) - 20);
  });

  it('asks the model for no text and no logo in the picture, and for room where the words will sit', async () => {
    const s = await seed();
    const provider = await posterProvider();
    await generateAssets(s.o.ownerCtx, { productId: s.productId, purpose: 'launch', textPosition: 'top' }, provider);
    const writer = JSON.stringify(provider.chatCalls[0].messages);
    expect(writer).toMatch(/No text, letters/);
    expect(writer).toMatch(/top 40%/);
    expect(provider.chatCalls[1].schema?.name).toBe('poster_copy'); // structured output for the words
  });

  it('drops words that carry a price, a discount or any figure that is not in the facts, and uses the fallback', async () => {
    const s = await seed();
    for (const bad of [
      { headline: 'Hanya Rp 99.000', subheadline: 'Murah', cta: 'Beli' },
      { headline: 'Diskon 50% hari ini', subheadline: 'Terbatas', cta: 'Beli' },
      { headline: 'Dipercaya 5.000 agensi', subheadline: 'Terbaik', cta: 'Coba' },
      { headline: 'Lebih rapi', subheadline: 'Mulai 99 ribu', cta: 'Coba' },
    ]) {
      const asset = await makePoster(s, bad);
      expect(asset.posterCopy, JSON.stringify(bad)).toMatchObject({ headline: 'Orbit CRM', cta: 'Coba sekarang' });
    }
  });

  it('still makes a poster with fallback words when the model cannot write them or answers nonsense', async () => {
    const s = await seed();
    const down = new FakeProvider({ chat: [say(PROMPT), new AiProviderError('unavailable', 'down')], image: [await realPicture()] });
    const a = await generateAssets(s.o.ownerCtx, { productId: s.productId, purpose: 'promo' }, down);
    const junk = await generateAssets(s.o.ownerCtx, { productId: s.productId, purpose: 'promo' }, new FakeProvider({ chat: [say(PROMPT), sayJson({ nope: true })], image: [await realPicture()] }));
    for (const r of [a, junk]) {
      if (!r.ok) throw new Error('poster failed');
      expect(r.assets[0].posterCopy).toMatchObject({ headline: 'Orbit CRM', cta: 'Lihat penawaran' });
    }
  });

  it('can be made without text, and then there is no background copy and no poster text', async () => {
    const s = await seed();
    const r = await generateAssets(s.o.ownerCtx, { productId: s.productId, purpose: 'launch', withText: false }, new FakeProvider({ chat: [say(PROMPT)], image: [await realPicture()] }));
    if (!r.ok) throw new Error('failed');
    expect(r.assets[0]).toMatchObject({ posterCopy: null, backgroundFileId: null });
  });

  it('editing the words draws the poster again from the saved background, without the model, and replaces the file', async () => {
    const s = await seed();
    const asset = await makePoster(s);
    const before = await bytesOf(asset.fileId);
    const keysBefore = store.keys().length;
    const updated = await updatePosterCopy(s.o.staffCtx, asset.id, { headline: 'Sewa tanpa pusing', subheadline: null, cta: 'Hubungi kami', showPrice: true, textPosition: 'top', logo: true, corner: 'top_left' });
    expect(updated.fileId).not.toBe(asset.fileId);
    expect(updated.backgroundFileId).toBe(asset.backgroundFileId);
    expect(updated.posterCopy).toMatchObject({ headline: 'Sewa tanpa pusing', textPosition: 'top', showPrice: true, subheadline: null });
    expect(Buffer.compare(Buffer.from(before), Buffer.from(await bytesOf(updated.fileId)))).not.toBe(0);
    expect(store.keys().length).toBe(keysBefore); // the old poster file is gone, the background stays
    expect(await db.select().from(files).where(eq(files.id, asset.fileId))).toHaveLength(0);
    const audit = await db.select().from(auditLog).where(and(eq(auditLog.orgId, s.o.orgId), eq(auditLog.action, 'marketing_asset.text_edited')));
    expect(audit).toHaveLength(1);
    expect((await imageQuotaStatus(s.o.ownerCtx)).used).toBe(1); // editing words used no quota
  });

  it('refuses to edit the words of a picture that has none, an empty headline, and another organization\'s poster', async () => {
    const s = await seed();
    const plain = await generateAssets(s.o.ownerCtx, { productId: s.productId, purpose: 'launch', withText: false }, new FakeProvider({ chat: [say(PROMPT)], image: [await realPicture()] }));
    if (!plain.ok) throw new Error('setup');
    await rejects(updatePosterCopy(s.o.ownerCtx, plain.assets[0].id, { headline: 'Halo', subheadline: null, cta: null }), 'invalid_state');
    const asset = await makePoster(s);
    await expect(updatePosterCopy(s.o.ownerCtx, asset.id, { headline: '  ', subheadline: null, cta: null })).rejects.toThrow();
    await expect(updatePosterCopy(s.o.ownerCtx, asset.id, { headline: 'x'.repeat(71), subheadline: null, cta: null })).rejects.toThrow();
    const other = await makeOrg();
    await rejects(updatePosterCopy(other.ownerCtx, asset.id, { headline: 'Halo', subheadline: null, cta: null }), 'not_found');
  });

  it('a revision keeps the words and the layout and draws them on the new picture', async () => {
    const s = await seed();
    const parent = await makePoster(s, COPY, { textPosition: 'top' });
    const rev = await reviseAsset(s.o.ownerCtx, parent.id, { instruction: 'lebih terang' }, new FakeProvider({ image: [await realPicture()] }));
    if (!rev.ok) throw new Error('revision failed');
    expect(rev.assets[0].posterCopy).toMatchObject({ headline: COPY.headline, textPosition: 'top' });
    expect(rev.assets[0].backgroundFileId).not.toBe(parent.backgroundFileId);
    expect(rev.assets[0].parentAssetId).toBe(parent.id);
  });

  it('deleting a poster removes its picture and its background from the database and storage', async () => {
    const s = await seed();
    const asset = await makePoster(s);
    expect(store.keys()).toHaveLength(2);
    await deleteAsset(s.o.ownerCtx, asset.id);
    expect(store.keys()).toHaveLength(0);
    expect(await db.select().from(files).where(and(eq(files.orgId, s.o.orgId), eq(files.kind, 'marketing_image')))).toHaveLength(0);
  });

  it('a company poster never shows a price even when asked, and the price of a product comes from its cheapest package', async () => {
    const s = await seed();
    await createPackage(s.o.ownerCtx, s.productId, { name: 'Dasar', monthlyPrice: 150_000 });
    const company = await generateAssets(s.o.ownerCtx, { productId: null, purpose: 'brand', showPrice: true }, await posterProvider());
    if (!company.ok) throw new Error('setup');
    expect(company.assets[0].posterCopy).toMatchObject({ showPrice: true }); // stored as asked, never drawn for a company
    const product = await makePoster(s, COPY, { showPrice: true });
    expect(product.posterCopy).toMatchObject({ showPrice: true });
    await updatePosterCopy(s.o.ownerCtx, product.id, { ...COPY, showPrice: true }); // renders with "Mulai dari Rp 150.000"
  });

  it('makes the poster in the chosen look, tells the model where to leave room, and lets the look be changed later without the model', async () => {
    const s = await seed();
    const provider = await posterProvider();
    const r = await generateAssets(s.o.ownerCtx, { productId: s.productId, purpose: 'launch', layout: 'side' }, provider);
    if (!r.ok) throw new Error('failed');
    expect(r.assets[0].posterCopy).toMatchObject({ layout: 'side' });
    expect(JSON.stringify(provider.chatCalls[0].messages)).toMatch(/left 60%/);

    const asset = r.assets[0];
    for (const layout of ['center', 'card', 'band', 'gradient'] as const) {
      const updated = await updatePosterCopy(s.o.ownerCtx, asset.id, { ...(asset.posterCopy as object), layout } as never);
      expect(updated.posterCopy).toMatchObject({ layout });
    }
    expect(store.keys()).toHaveLength(2); // always one poster file and its background, however often the look changes
  });

  it('a revision keeps the look of its parent', async () => {
    const s = await seed();
    const parent = await generateAssets(s.o.ownerCtx, { productId: s.productId, purpose: 'launch', layout: 'card', textPosition: 'top' }, await posterProvider());
    if (!parent.ok) throw new Error('setup');
    const rev = await reviseAsset(s.o.ownerCtx, parent.assets[0].id, { instruction: 'lebih terang' }, new FakeProvider({ image: [await realPicture()] }));
    if (!rev.ok) throw new Error('revision failed');
    expect(rev.assets[0].posterCopy).toMatchObject({ layout: 'card', textPosition: 'top' });
  });
});
