import { createHash } from 'node:crypto';
import { and, asc, desc, eq, gte, isNull, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { getAiProvider } from '../../ai';
import type { AiProvider } from '../../ai/provider';
import { chatOnce, generateImagesOnce } from '../../ai/run';
import { wrapUntrusted } from '../../ai/untrusted';
import { db } from '../../db/client';
import { newId } from '../../db/ids';
import { aiRuns, brandKits, files, marketingAssets, organizations, packages, products } from '../../db/schema';
import { storage } from '../../integrations/storage';
import { env } from '../../lib/env';
import { formatRupiah } from '../../lib/format';
import { zonedDayStart } from '../ai/budget';
import { recordAudit } from '../audit/service';
import type { Ctx } from '../ctx';
import { DomainError } from '../errors';
import { assertCan, can } from '../permissions';
import { who } from '../portfolio/shared';
import {
  ASPECTS,
  DEFAULT_DAILY_IMAGE_QUOTA,
  assetFilterSchema,
  brandKitSchema,
  captionInstructions,
  captionTextSchema,
  factsText,
  fallbackImagePrompt,
  foreignCaptionFigures,
  generateSchema,
  promptWriterInstructions,
  remainingQuota,
  reviseSchema,
  type BrandFacts,
  type Purpose,
  type ProductFacts,
} from './rules';

type AssetRow = typeof marketingAssets.$inferSelect;

export type StudioResult<T> = ({ ok: true } & T) | { ok: false; message: string; kind: string };

export function dailyImageQuota(): number {
  const n = Number(env('MARKETING_DAILY_IMAGE_QUOTA'));
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_DAILY_IMAGE_QUOTA;
}

// ---------------------------------------------------------------------------------------------------------------------
// Brand kit

/** The organization's brand kit, or null before anyone has filled it. Everyone who may use the studio can read it. */
export async function getBrandKit(ctx: Ctx) {
  assertCan(ctx, 'marketing.use');
  const [row] = await db.select().from(brandKits).where(eq(brandKits.orgId, ctx.orgId));
  return row ?? null;
}

/** Owner and Admin only; the change is audited (BR-M10-11). */
export async function saveBrandKit(ctx: Ctx, raw: z.input<typeof brandKitSchema>) {
  assertCan(ctx, 'marketing.brand_kit');
  const input = brandKitSchema.parse(raw);
  return db.transaction(async (tx) => {
    const values = { brandName: input.brandName, colors: input.colors ?? null, tone: input.tone ?? null, prohibitions: input.prohibitions ?? null };
    const [row] = await tx.insert(brandKits).values({ orgId: ctx.orgId, ...values }).onConflictDoUpdate({ target: brandKits.orgId, set: values }).returning();
    await recordAudit(tx, who(ctx), { action: 'brand_kit.saved', entityType: 'brand_kit', entityId: row.id, summary: { brandName: input.brandName } });
    return row;
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Facts and quota

/** Products a person can make content for: active ones only. */
export async function listStudioProducts(ctx: Ctx) {
  assertCan(ctx, 'marketing.use');
  return db.select({ id: products.id, name: products.name }).from(products).where(and(eq(products.orgId, ctx.orgId), isNull(products.archivedAt))).orderBy(asc(products.name));
}

async function loadFacts(ctx: Ctx, productId: string): Promise<{ product: ProductFacts; brand: BrandFacts; locale: 'id' | 'en' }> {
  const [[product], pkgs, [kit], [org]] = await Promise.all([
    db.select({ name: products.name, description: products.description }).from(products).where(and(eq(products.orgId, ctx.orgId), eq(products.id, productId), isNull(products.archivedAt))),
    db
      .select({ name: packages.name, price: packages.monthlyPrice, features: packages.features })
      .from(packages)
      .where(and(eq(packages.orgId, ctx.orgId), eq(packages.productId, productId), isNull(packages.archivedAt)))
      .orderBy(asc(packages.monthlyPrice)),
    db.select().from(brandKits).where(eq(brandKits.orgId, ctx.orgId)),
    db.select({ name: organizations.name, locale: organizations.locale }).from(organizations).where(eq(organizations.id, ctx.orgId)),
  ]);
  if (!product) throw new DomainError('not_found', 'product');
  return {
    product: { ...product, packages: pkgs.map((p) => ({ name: p.name, price: formatRupiah(p.price), features: p.features })) },
    // Without a brand kit the organization's own name stands in, so the studio works from the first day.
    brand: kit ? { brandName: kit.brandName, colors: kit.colors, tone: kit.tone, prohibitions: kit.prohibitions } : { brandName: org?.name ?? '' },
    locale: org?.locale ?? 'id',
  };
}

/** Images made today in the organization's time zone, counted from `ai_runs` so failed or blocked calls do not use quota. */
export async function imageQuotaStatus(ctx: Ctx, now: Date = ctx.clock.now()) {
  assertCan(ctx, 'marketing.use');
  const [org] = await db.select({ timezone: organizations.timezone }).from(organizations).where(eq(organizations.id, ctx.orgId));
  const dayStart = zonedDayStart(now, org?.timezone ?? 'Asia/Jakarta');
  const [row] = await db
    .select({ used: sql<string>`coalesce(sum(${aiRuns.images}), 0)::text` })
    .from(aiRuns)
    .where(and(eq(aiRuns.orgId, ctx.orgId), eq(aiRuns.feature, 'image'), eq(aiRuns.status, 'ok'), gte(aiRuns.startedAt, dayStart)));
  const quota = dailyImageQuota();
  const used = Number(row?.used ?? 0);
  return { quota, used, remaining: remainingQuota(quota, used) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Images

/** The image prompt: written by the model from the facts, or built from the facts alone if the model cannot (BR-M10-01). */
async function writePrompt(ctx: Ctx, provider: AiProvider, facts: { product: ProductFacts; brand: BrandFacts; locale: 'id' | 'en' }, purpose: Purpose, direction: string | null | undefined) {
  const fallback = fallbackImagePrompt(facts.product, facts.brand, purpose, direction);
  const data = `${factsText(facts.product, facts.brand)}\nTujuan: ${purpose}`;
  const out = await chatOnce({
    db,
    ctx,
    provider,
    locale: facts.locale,
    feature: 'agent',
    inputSummary: `Prompt gambar ${purpose}`,
    entityType: 'product',
    request: {
      messages: [
        { role: 'developer', content: promptWriterInstructions() },
        { role: 'user', content: data + (direction ? `\n\n${wrapUntrusted('arahan pengguna', direction)}` : '') },
      ],
      effort: 'low',
      maxTokens: 1200,
    },
  });
  const text = out.ok ? (out.value.text ?? '').trim() : '';
  return text.length >= 20 ? text : fallback;
}

/** Stores the pictures and their rows together; nothing is left half-saved if the database refuses (BR-M10-09). */
async function saveImages(ctx: Ctx, input: { productId: string; purpose: Purpose; prompt: string; parentAssetId: string | null; aiRunId: string }, images: Array<{ bytes: Uint8Array; mime: string }>) {
  const keys: string[] = [];
  try {
    for (const image of images) {
      const key = `org/${ctx.orgId}/marketing/${newId()}.webp`;
      await storage().put(key, image.bytes, image.mime);
      keys.push(key);
    }
    return await db.transaction(async (tx) => {
      const out: AssetRow[] = [];
      for (const [i, image] of images.entries()) {
        const fileId = newId();
        await tx.insert(files).values({
          id: fileId,
          orgId: ctx.orgId,
          kind: 'marketing_image',
          storageKey: keys[i],
          mime: image.mime,
          sizeBytes: image.bytes.byteLength,
          sha256: createHash('sha256').update(image.bytes).digest('hex'),
          isAiGenerated: true,
          createdBy: ctx.userId,
        });
        const [row] = await tx
          .insert(marketingAssets)
          .values({ orgId: ctx.orgId, productId: input.productId, purpose: input.purpose, prompt: input.prompt, parentAssetId: input.parentAssetId, fileId, aiRunId: input.aiRunId, createdBy: ctx.userId })
          .returning();
        await recordAudit(tx, who(ctx), {
          action: input.parentAssetId ? 'marketing_asset.revised' : 'marketing_asset.generated',
          entityType: 'marketing_asset',
          entityId: row.id,
          summary: { productId: input.productId, purpose: input.purpose, runId: input.aiRunId },
        });
        out.push(row);
      }
      return out;
    });
  } catch (err) {
    await Promise.all(keys.map((key) => storage().delete(key).catch(() => undefined))); // nothing points at them now
    throw err;
  }
}

/**
 * Makes one to four images for a product (BRD-M10 section 4). The quota is checked first (BR-M10-06) and the AI budget
 * inside the call; a request the safety filter refuses comes back as a plain message and is not charged (BR-M10-08).
 * Nothing is published anywhere (BR-M10-03).
 */
export async function generateAssets(ctx: Ctx, raw: z.input<typeof generateSchema>, provider: AiProvider = getAiProvider()): Promise<StudioResult<{ assets: AssetRow[] }>> {
  assertCan(ctx, 'marketing.use');
  const input = generateSchema.parse(raw);
  const quota = await imageQuotaStatus(ctx);
  if (input.variants > quota.remaining) return quotaRefusal(quota);

  const facts = await loadFacts(ctx, input.productId);
  const prompt = await writePrompt(ctx, provider, facts, input.purpose, input.direction);
  return render(ctx, provider, facts.locale, { productId: input.productId, purpose: input.purpose, prompt, parentAssetId: null, variants: input.variants, size: ASPECTS[input.aspect] });
}

/**
 * A revision is a fresh image from the old prompt plus the person's instruction; the old image stays (BRD-M10 section 10).
 * The API has no edit-by-image yet in our integration, so this is a new generation, not a pixel edit.
 */
export async function reviseAsset(ctx: Ctx, id: string, raw: z.input<typeof reviseSchema>, provider: AiProvider = getAiProvider()): Promise<StudioResult<{ assets: AssetRow[] }>> {
  assertCan(ctx, 'marketing.use');
  const { instruction } = reviseSchema.parse(raw);
  const parent = await loadAsset(ctx, id);
  const quota = await imageQuotaStatus(ctx);
  if (quota.remaining < 1) return quotaRefusal(quota);
  const [org] = await db.select({ locale: organizations.locale }).from(organizations).where(eq(organizations.id, ctx.orgId));
  const prompt = `${parent.prompt}\n\nRevision requested by the user: ${instruction}\nKeep the same rules: no text, letters, numbers or logos in the image.`;
  return render(ctx, provider, org?.locale ?? 'id', { productId: parent.productId, purpose: parent.purpose, prompt, parentAssetId: parent.id, variants: 1, size: undefined });
}

function quotaRefusal(quota: { quota: number; used: number }): StudioResult<never> {
  return { ok: false, kind: 'quota', message: `quota:${quota.used}/${quota.quota}` };
}

async function render(
  ctx: Ctx,
  provider: AiProvider,
  locale: 'id' | 'en',
  job: { productId: string; purpose: Purpose; prompt: string; parentAssetId: string | null; variants: number; size: string | undefined },
): Promise<StudioResult<{ assets: AssetRow[] }>> {
  const out = await generateImagesOnce({
    db,
    ctx,
    provider,
    locale,
    inputSummary: `Gambar ${job.purpose} (${job.variants} varian)`,
    entityType: 'product',
    entityId: job.productId,
    request: { prompt: job.prompt, n: job.variants, size: job.size, grounding: false, safetyIdentifier: createHash('sha256').update(ctx.userId).digest('hex').slice(0, 32) },
  });
  if (!out.ok) return { ok: false, kind: out.kind, message: out.message };
  const assets = await saveImages(ctx, { productId: job.productId, purpose: job.purpose, prompt: job.prompt, parentAssetId: job.parentAssetId, aiRunId: out.runId }, out.value.images);
  return { ok: true, assets };
}

// ---------------------------------------------------------------------------------------------------------------------
// Caption

/**
 * A caption from the product's facts (BRD-M10 step 4). Prices may only be the official package prices; a caption with any
 * other figure is thrown away rather than patched (BR-M10-01, -02), like narrative in M06.
 */
export async function draftCaption(ctx: Ctx, id: string, provider: AiProvider = getAiProvider()): Promise<StudioResult<{ caption: string }>> {
  assertCan(ctx, 'marketing.use');
  const asset = await loadAsset(ctx, id);
  const facts = await loadFacts(ctx, asset.productId);
  const data = factsText(facts.product, facts.brand);
  const out = await chatOnce({
    db,
    ctx,
    provider,
    locale: facts.locale,
    feature: 'agent',
    inputSummary: `Caption ${asset.purpose}`,
    entityType: 'marketing_asset',
    entityId: id,
    request: { messages: [{ role: 'developer', content: captionInstructions(facts.locale, asset.purpose) }, { role: 'user', content: data }], effort: 'low', maxTokens: 1200 },
  });
  if (!out.ok) return { ok: false, kind: out.kind, message: out.message };
  const caption = (out.value.text ?? '').trim();
  if (!caption || foreignCaptionFigures(caption, data).length > 0) return { ok: false, kind: 'foreign_figures', message: 'foreign_figures' };
  await saveCaption(ctx, id, caption, out.runId);
  return { ok: true, caption };
}

/** A person's own edit of the caption. */
export async function updateCaption(ctx: Ctx, id: string, raw: z.input<typeof captionTextSchema>) {
  assertCan(ctx, 'marketing.use');
  const { caption } = captionTextSchema.parse(raw);
  await loadAsset(ctx, id);
  await saveCaption(ctx, id, caption, null);
}

async function saveCaption(ctx: Ctx, id: string, caption: string, runId: string | null) {
  await db.transaction(async (tx) => {
    await tx.update(marketingAssets).set({ caption }).where(and(eq(marketingAssets.orgId, ctx.orgId), eq(marketingAssets.id, id)));
    await recordAudit(tx, who(ctx), { action: runId ? 'marketing_asset.caption_drafted' : 'marketing_asset.caption_edited', entityType: 'marketing_asset', entityId: id, summary: { runId, characters: caption.length } });
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Gallery

async function loadAsset(ctx: Ctx, id: string): Promise<AssetRow> {
  const [row] = await db.select().from(marketingAssets).where(and(eq(marketingAssets.orgId, ctx.orgId), eq(marketingAssets.id, id)));
  if (!row) throw new DomainError('not_found', 'asset');
  return row;
}

export async function listAssets(ctx: Ctx, raw: z.input<typeof assetFilterSchema> = {}) {
  assertCan(ctx, 'marketing.use');
  const f = assetFilterSchema.parse(raw);
  return db
    .select({
      id: marketingAssets.id,
      productId: marketingAssets.productId,
      productName: products.name,
      purpose: marketingAssets.purpose,
      parentAssetId: marketingAssets.parentAssetId,
      caption: marketingAssets.caption,
      createdBy: marketingAssets.createdBy,
      createdAt: marketingAssets.createdAt,
    })
    .from(marketingAssets)
    .innerJoin(products, and(eq(products.orgId, marketingAssets.orgId), eq(products.id, marketingAssets.productId)))
    .where(and(eq(marketingAssets.orgId, ctx.orgId), f.productId ? eq(marketingAssets.productId, f.productId) : undefined, f.purpose ? eq(marketingAssets.purpose, f.purpose) : undefined))
    .orderBy(desc(marketingAssets.createdAt))
    .limit(200);
}

export async function getAsset(ctx: Ctx, id: string) {
  assertCan(ctx, 'marketing.use');
  return loadAsset(ctx, id);
}

/** The picture for download or display. Always found through the row's `org_id` (BR-M10-09). */
export async function readAssetFile(ctx: Ctx, id: string): Promise<{ bytes: Uint8Array; mime: string; name: string }> {
  assertCan(ctx, 'marketing.use');
  const asset = await loadAsset(ctx, id);
  const [file] = await db.select().from(files).where(and(eq(files.orgId, ctx.orgId), eq(files.id, asset.fileId), isNull(files.deletedAt)));
  if (!file) throw new DomainError('not_found', 'file');
  return { bytes: await storage().get(file.storageKey), mime: file.mime, name: `${asset.purpose}-${asset.id}.webp` };
}

/** Owner and Admin delete any asset; Staff only their own (BRD-M10 section 2). Revisions of a deleted image keep standing. */
export async function deleteAsset(ctx: Ctx, id: string): Promise<void> {
  assertCan(ctx, 'marketing.use');
  const asset = await loadAsset(ctx, id);
  if (!can(ctx.role, 'marketing.delete_any') && asset.createdBy !== ctx.userId) throw new DomainError('forbidden', 'only your own assets');
  const key = await db.transaction(async (tx) => {
    await tx.update(marketingAssets).set({ parentAssetId: null }).where(and(eq(marketingAssets.orgId, ctx.orgId), eq(marketingAssets.parentAssetId, id)));
    await tx.delete(marketingAssets).where(and(eq(marketingAssets.orgId, ctx.orgId), eq(marketingAssets.id, id)));
    const [file] = await tx.delete(files).where(and(eq(files.orgId, ctx.orgId), eq(files.id, asset.fileId))).returning({ key: files.storageKey });
    await recordAudit(tx, who(ctx), { action: 'marketing_asset.deleted', entityType: 'marketing_asset', entityId: id, summary: { productId: asset.productId } });
    return file?.key;
  });
  if (key) await storage().delete(key).catch((err) => console.error('marketing image could not be removed from storage', err instanceof Error ? err.message : err));
}
