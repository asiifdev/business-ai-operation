import { and, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { AiProviderError } from '../../../ai/errors';
import { FakeProvider, say } from '../../../ai/fake-provider';
import type { ImageResult } from '../../../ai/types';
import { db, pg } from '../../../db/client';
import { aiRuns, auditLog, files, marketingAssets } from '../../../db/schema';
import { setStorage, type Storage } from '../../../integrations/storage';
import { makeOrg } from '../../ai/__tests__/support';
import { DomainError } from '../../errors';
import { createPackage, createProduct, updatePackage } from '../../portfolio/products';
import { deleteAsset, draftCaption, generateAssets, getBrandKit, imageQuotaStatus, listAssets, readAssetFile, reviseAsset, saveBrandKit, updateCaption } from '../service';

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
    const r = await generateAssets(s.o.staffCtx, { productId: s.productId, purpose: 'launch', variants: 2 }, provider);
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
    const r = await generateAssets(s.o.ownerCtx, { productId: s.productId, purpose: 'promo' }, provider);
    expect(r.ok).toBe(true);
    expect(provider.imageCalls[0].prompt).toContain('Orbit CRM');
    expect(provider.imageCalls[0].prompt).toMatch(/No text, letters/);
  });

  it('a safety-filter refusal is a plain message, saves nothing, and uses no quota (BR-M10-08)', async () => {
    const s = await seed();
    const provider = new FakeProvider({ chat: [say(PROMPT)], image: [new AiProviderError('content_policy', 'blocked')] });
    const r = await generateAssets(s.o.ownerCtx, { productId: s.productId, purpose: 'promo' }, provider);
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
      expect((await generateAssets(s.o.ownerCtx, { productId: s.productId, purpose: 'launch', variants: 2 }, provider)).ok).toBe(true);
      const blocked = new FakeProvider();
      const r = await generateAssets(s.o.ownerCtx, { productId: s.productId, purpose: 'launch' }, blocked);
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
    const r = await generateAssets(s.o.ownerCtx, { productId: s.productId, purpose: 'launch' }, provider);
    expect(r).toMatchObject({ ok: false, kind: 'budget' });
    const runs = await db.select().from(aiRuns).where(and(eq(aiRuns.orgId, s.o.orgId), eq(aiRuns.feature, 'image')));
    expect(runs.map((x) => x.status)).toEqual(['blocked_budget']);
  });

  it('a revision is a new image that points at the old one, which stays (BRD-M10 section 10)', async () => {
    const s = await seed();
    const first = await generateAssets(s.o.ownerCtx, { productId: s.productId, purpose: 'launch' }, new FakeProvider({ chat: [say(PROMPT)], image: [pictures(1)] }));
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
    const made = await generateAssets(s.o.ownerCtx, { productId: s.productId, purpose: 'promo' }, new FakeProvider({ chat: [say(PROMPT)], image: [pictures(1)] }));
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
    const made = await generateAssets(s.o.ownerCtx, { productId: s.productId, purpose: 'promo' }, new FakeProvider({ chat: [say(PROMPT)], image: [pictures(1)] }));
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
    const mine = await generateAssets(s.o.staffCtx, { productId: s.productId, purpose: 'launch' }, new FakeProvider({ chat: [say(PROMPT)], image: [pictures(1)] }));
    const theirs = await generateAssets(s.o.ownerCtx, { productId: s.productId, purpose: 'launch' }, new FakeProvider({ chat: [say(PROMPT)], image: [pictures(1)] }));
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
    const made = await generateAssets(s.o.ownerCtx, { productId: s.productId, purpose: 'launch' }, new FakeProvider({ chat: [say(PROMPT)], image: [pictures(1)] }));
    if (!made.ok) throw new Error('setup');
    const id = made.assets[0].id;
    await rejects(readAssetFile(other.ownerCtx, id), 'not_found');
    await rejects(reviseAsset(other.ownerCtx, id, { instruction: 'lebih cerah' }, new FakeProvider()), 'not_found');
    await rejects(updateCaption(other.ownerCtx, id, { caption: 'x' }), 'not_found');
    await rejects(deleteAsset(other.ownerCtx, id), 'not_found');
    await rejects(generateAssets(other.ownerCtx, { productId: s.productId, purpose: 'launch' }, new FakeProvider()), 'not_found');
    expect(await listAssets(other.ownerCtx)).toHaveLength(0);
    expect((await readAssetFile(s.o.ownerCtx, id)).bytes).toEqual(WEBP);
  });

  it('the database refuses an asset that points at another organization\'s file', async () => {
    const s = await seed();
    const other = await makeOrg();
    const made = await generateAssets(other.ownerCtx, { productId: (await createProduct(other.ownerCtx, { name: 'Lain' })).id, purpose: 'launch' }, new FakeProvider({ chat: [say(PROMPT)], image: [pictures(1)] }));
    if (!made.ok) throw new Error('setup');
    const err = await db.insert(marketingAssets).values({ orgId: s.o.orgId, productId: s.productId, purpose: 'launch', prompt: 'x', fileId: made.assets[0].fileId, createdBy: s.o.ownerCtx.userId }).then(() => null, (e: unknown) => e);
    expect(err).not.toBeNull();
  });
});
