import { createHash } from 'node:crypto';
import { and, asc, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
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
import { readLogoFile } from '../portfolio/logo';
import { applyLogo } from './poster';
import { firstHex, renderPoster } from './poster-render';
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
  copyJsonSchema,
  copyWriterInstructions,
  fallbackCopy,
  posterCopySchema,
  priceLine,
  captionTextSchema,
  factsText,
  fallbackImagePrompt,
  foreignCaptionFigures,
  generateSchema,
  promptWriterInstructions,
  remainingQuota,
  reviseSchema,
  type BrandFacts,
  type Corner,
  type PosterCopy,
  type PromptSpace,
  spaceFor,
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
  return db.select({ id: products.id, name: products.name, hasLogo: sql<boolean>`${products.logoFileId} is not null` }).from(products).where(and(eq(products.orgId, ctx.orgId), isNull(products.archivedAt))).orderBy(asc(products.name));
}

/**
 * The facts a model may repeat. For a product: its name, description and official packages with prices. For the company
 * (`productId` empty, D-066): the brand plus the names and descriptions of active products, and no prices at all.
 */
async function loadFacts(ctx: Ctx, productId: string | null): Promise<{ product: ProductFacts; brand: BrandFacts; locale: 'id' | 'en' }> {
  const [[kit], [org]] = await Promise.all([
    db.select().from(brandKits).where(eq(brandKits.orgId, ctx.orgId)),
    db.select({ name: organizations.name, locale: organizations.locale }).from(organizations).where(eq(organizations.id, ctx.orgId)),
  ]);
  // Without a brand kit the organization's own name stands in, so the studio works from the first day.
  const brand: BrandFacts = kit ? { brandName: kit.brandName, colors: kit.colors, tone: kit.tone, prohibitions: kit.prohibitions } : { brandName: org?.name ?? '' };
  const locale = org?.locale ?? 'id';
  if (!productId) {
    const offerings = await db
      .select({ name: products.name, description: products.description })
      .from(products)
      .where(and(eq(products.orgId, ctx.orgId), isNull(products.archivedAt)))
      .orderBy(asc(products.name))
      .limit(12);
    return { product: { name: brand.brandName, company: true, offerings, packages: [] }, brand, locale };
  }
  const [[product], pkgs] = await Promise.all([
    db.select({ name: products.name, description: products.description }).from(products).where(and(eq(products.orgId, ctx.orgId), eq(products.id, productId), isNull(products.archivedAt))),
    db
      .select({ name: packages.name, price: packages.monthlyPrice, features: packages.features })
      .from(packages)
      .where(and(eq(packages.orgId, ctx.orgId), eq(packages.productId, productId), isNull(packages.archivedAt)))
      .orderBy(asc(packages.monthlyPrice)),
  ]);
  if (!product) throw new DomainError('not_found', 'product');
  return { product: { ...product, packages: pkgs.map((p) => ({ name: p.name, price: formatRupiah(p.price), features: p.features })) }, brand, locale };
}

/** The logo a poster carries: the product's own, else the company's, else none (D-066). */
async function resolveLogo(ctx: Ctx, productId: string | null): Promise<{ bytes: Uint8Array; mime: string } | null> {
  if (productId) {
    const [p] = await db.select({ logoFileId: products.logoFileId }).from(products).where(and(eq(products.orgId, ctx.orgId), eq(products.id, productId)));
    const own = await readLogoFile(ctx.orgId, p?.logoFileId ?? null);
    if (own) return own;
  }
  const [kit] = await db.select({ logoFileId: brandKits.logoFileId }).from(brandKits).where(eq(brandKits.orgId, ctx.orgId));
  return readLogoFile(ctx.orgId, kit?.logoFileId ?? null);
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

type Facts = { product: ProductFacts; brand: BrandFacts; locale: 'id' | 'en' };

/** The image prompt: written by the model from the facts, or built from the facts alone if the model cannot (BR-M10-01). */
async function writePrompt(ctx: Ctx, provider: AiProvider, facts: Facts, purpose: Purpose, direction: string | null | undefined, space: PromptSpace | null) {
  const fallback = fallbackImagePrompt(facts.product, facts.brand, purpose, direction, space);
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
        { role: 'developer', content: promptWriterInstructions(space) },
        { role: 'user', content: data + (direction ? `\n\n${wrapUntrusted('arahan pengguna', direction)}` : '') },
      ],
      effort: 'low',
      maxTokens: 1200,
    },
  });
  const text = out.ok ? (out.value.text ?? '').trim() : '';
  return text.length >= 20 ? text : fallback;
}

const copyAnswer = z.object({ headline: z.string(), subheadline: z.string(), cta: z.string() });

/**
 * The words on the poster: written by the model from the facts, then checked. Any figure that is not in the facts, or any
 * mention of a price, discards the answer and the copy is built from the facts alone (BR-M10-01, -02); a price is only ever
 * added by code. A poster is never left without words.
 */
async function writeCopy(ctx: Ctx, provider: AiProvider, facts: Facts, purpose: Purpose) {
  const fallback = fallbackCopy(facts.product, facts.brand, purpose, facts.locale);
  const data = `${factsText(facts.product, facts.brand)}\nTujuan: ${purpose}`;
  const out = await chatOnce({
    db,
    ctx,
    provider,
    locale: facts.locale,
    feature: 'agent',
    inputSummary: `Teks poster ${purpose}`,
    entityType: 'product',
    request: {
      messages: [{ role: 'developer', content: copyWriterInstructions(facts.locale, Boolean(facts.product.company)) }, { role: 'user', content: data }],
      schema: { name: 'poster_copy', schema: copyJsonSchema as unknown as Record<string, unknown>, strict: true },
      effort: 'low',
      maxTokens: 1200,
    },
  });
  if (!out.ok) return fallback;
  let raw: unknown = out.value.json;
  if (raw === undefined && out.value.text) raw = (() => { try { return JSON.parse(out.value.text!); } catch { return undefined; } })();
  const parsed = copyAnswer.safeParse(raw);
  if (!parsed.success) return fallback;
  const headline = parsed.data.headline.trim().slice(0, 70);
  const subheadline = parsed.data.subheadline.trim().slice(0, 160) || null;
  const cta = parsed.data.cta.trim().slice(0, 30) || fallback.cta;
  const all = [headline, subheadline ?? '', cta].join(' ');
  if (!headline || /\b(rp|idr|usd)\b|\$/i.test(all) || foreignCaptionFigures(all, data).length > 0) return fallback;
  return { headline, subheadline, cta };
}

const priceLineOf = (facts: Facts, copy: PosterCopy) => (copy.showPrice && !facts.product.company && facts.product.packages[0] ? priceLine(facts.locale, facts.product.packages[0].price) : null);

/** Draws the poster from a background. If drawing fails the picture is kept with its logo, so the work is never lost. */
async function composePoster(ctx: Ctx, facts: Facts, productId: string | null, background: Uint8Array, copy: PosterCopy): Promise<Uint8Array> {
  const logo = copy.logo ? await resolveLogo(ctx, productId) : null;
  try {
    return await renderPoster({ background, logo: logo?.bytes ?? null, text: { headline: copy.headline, subheadline: copy.subheadline, cta: copy.cta }, priceLine: priceLineOf(facts, copy), layout: copy.layout, textPosition: copy.textPosition, corner: copy.corner, accent: firstHex(facts.brand.colors) });
  } catch (err) {
    console.error('poster text could not be drawn', err instanceof Error ? err.message : err);
    return logo ? await applyLogo(background, logo.bytes, copy.corner).catch(() => background) : background;
  }
}

interface NewImage {
  /** The finished picture people download. */
  poster: Uint8Array;
  /** The model's own picture, kept so the text can be edited and drawn again without the model (D-067). */
  background?: Uint8Array;
  copy?: PosterCopy;
}

/** Stores the pictures and their rows together; nothing is left half-saved if the database refuses (BR-M10-09). */
async function saveImages(ctx: Ctx, input: { productId: string | null; purpose: Purpose; prompt: string; parentAssetId: string | null; aiRunId: string }, images: NewImage[]) {
  const keys: string[] = [];
  const put = async (bytes: Uint8Array) => {
    const key = `org/${ctx.orgId}/marketing/${newId()}.webp`;
    await storage().put(key, bytes, 'image/webp');
    keys.push(key);
    return key;
  };
  const fileRow = (id: string, key: string, bytes: Uint8Array) => ({ id, orgId: ctx.orgId, kind: 'marketing_image' as const, storageKey: key, mime: 'image/webp', sizeBytes: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex'), isAiGenerated: true, createdBy: ctx.userId });
  try {
    const stored = await Promise.all(images.map(async (image) => ({ posterKey: await put(image.poster), backgroundKey: image.background ? await put(image.background) : null })));
    return await db.transaction(async (tx) => {
      const out: AssetRow[] = [];
      for (const [i, image] of images.entries()) {
        const fileId = newId();
        await tx.insert(files).values(fileRow(fileId, stored[i].posterKey, image.poster));
        let backgroundFileId: string | null = null;
        if (image.background && stored[i].backgroundKey) {
          backgroundFileId = newId();
          await tx.insert(files).values(fileRow(backgroundFileId, stored[i].backgroundKey!, image.background));
        }
        const [row] = await tx
          .insert(marketingAssets)
          .values({ orgId: ctx.orgId, productId: input.productId, purpose: input.purpose, prompt: input.prompt, parentAssetId: input.parentAssetId, fileId, backgroundFileId, posterCopy: image.copy ?? null, aiRunId: input.aiRunId, createdBy: ctx.userId })
          .returning();
        await recordAudit(tx, who(ctx), {
          action: input.parentAssetId ? 'marketing_asset.revised' : 'marketing_asset.generated',
          entityType: 'marketing_asset',
          entityId: row.id,
          summary: { productId: input.productId, purpose: input.purpose, runId: input.aiRunId, withText: Boolean(image.copy) },
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
 * Makes one to four posters for a product or for the company (BRD-M10 section 4, D-066, D-067). The quota is checked first
 * (BR-M10-06) and the AI budget inside the call; a request the safety filter refuses comes back as a plain message and is
 * not charged (BR-M10-08). The model draws the picture only; the words, the button and the real logo are drawn by code.
 * Nothing is published anywhere (BR-M10-03).
 */
export async function generateAssets(ctx: Ctx, raw: z.input<typeof generateSchema>, provider: AiProvider = getAiProvider()): Promise<StudioResult<{ assets: AssetRow[] }>> {
  assertCan(ctx, 'marketing.use');
  const input = generateSchema.parse(raw);
  const quota = await imageQuotaStatus(ctx);
  if (input.variants > quota.remaining) return quotaRefusal(quota);

  const facts = await loadFacts(ctx, input.productId ?? null);
  const space = input.withText ? spaceFor(input.layout, input.textPosition) : null;
  const prompt = await writePrompt(ctx, provider, facts, input.purpose, input.direction, space);
  const text = input.withText ? await writeCopy(ctx, provider, facts, input.purpose) : null;
  const copy: PosterCopy | null = text ? { ...text, showPrice: input.showPrice, layout: input.layout, textPosition: input.textPosition, logo: input.logo, corner: input.corner } : null;
  return render(ctx, provider, facts, { productId: input.productId ?? null, purpose: input.purpose, prompt, parentAssetId: null, variants: input.variants, size: ASPECTS[input.aspect], copy, plainLogo: input.logo ? input.corner : null });
}

/**
 * A revision is a fresh picture from the old prompt plus the person's instruction; the old one stays (BRD-M10 section 10).
 * The poster text carries over to the new picture. Our integration has no edit-by-image yet, so this is a new generation.
 */
export async function reviseAsset(ctx: Ctx, id: string, raw: z.input<typeof reviseSchema>, provider: AiProvider = getAiProvider()): Promise<StudioResult<{ assets: AssetRow[] }>> {
  assertCan(ctx, 'marketing.use');
  const { instruction, logo, corner } = reviseSchema.parse(raw);
  const parent = await loadAsset(ctx, id);
  const quota = await imageQuotaStatus(ctx);
  if (quota.remaining < 1) return quotaRefusal(quota);
  const facts = await loadFacts(ctx, parent.productId);
  const prompt = `${parent.prompt}\n\nRevision requested by the user: ${instruction}\nKeep the same rules: no text, letters, numbers or logos in the image.`;
  const copy = parent.posterCopy ? posterCopySchema.safeParse(parent.posterCopy) : null;
  return render(ctx, provider, facts, { productId: parent.productId, purpose: parent.purpose, prompt, parentAssetId: parent.id, variants: 1, size: undefined, copy: copy?.success ? copy.data : null, plainLogo: logo ? corner : null });
}

function quotaRefusal(quota: { quota: number; used: number }): StudioResult<never> {
  return { ok: false, kind: 'quota', message: `quota:${quota.used}/${quota.quota}` };
}

async function render(
  ctx: Ctx,
  provider: AiProvider,
  facts: Facts,
  job: { productId: string | null; purpose: Purpose; prompt: string; parentAssetId: string | null; variants: number; size: string | undefined; copy: PosterCopy | null; plainLogo: Corner | null },
): Promise<StudioResult<{ assets: AssetRow[] }>> {
  const out = await generateImagesOnce({
    db,
    ctx,
    provider,
    locale: facts.locale,
    inputSummary: `Gambar ${job.purpose} (${job.variants} varian)`,
    entityType: job.productId ? 'product' : 'organization',
    entityId: job.productId ?? ctx.orgId,
    request: { prompt: job.prompt, n: job.variants, size: job.size, grounding: false, safetyIdentifier: createHash('sha256').update(ctx.userId).digest('hex').slice(0, 32) },
  });
  if (!out.ok) return { ok: false, kind: out.kind, message: out.message };
  const images: NewImage[] = await Promise.all(
    out.value.images.map(async (img): Promise<NewImage> => {
      if (job.copy) return { poster: await composePoster(ctx, facts, job.productId, img.bytes, job.copy), background: img.bytes, copy: job.copy };
      // No text asked for: the real logo still goes on, never drawn by the model.
      const logo = job.plainLogo ? await resolveLogo(ctx, job.productId) : null;
      return { poster: logo ? await applyLogo(img.bytes, logo.bytes, job.plainLogo!).catch(() => img.bytes) : img.bytes };
    }),
  );
  const assets = await saveImages(ctx, { productId: job.productId, purpose: job.purpose, prompt: job.prompt, parentAssetId: job.parentAssetId, aiRunId: out.runId }, images);
  return { ok: true, assets };
}

/**
 * A person edits the words (or the layout) of a poster and it is drawn again from the saved background: no model call, no
 * cost, no quota (D-067). What a person types is their own text; only text a model wrote is checked for invented figures.
 */
export async function updatePosterCopy(ctx: Ctx, id: string, raw: z.input<typeof posterCopySchema>): Promise<AssetRow> {
  assertCan(ctx, 'marketing.use');
  const copy = posterCopySchema.parse(raw);
  const asset = await loadAsset(ctx, id);
  if (!asset.backgroundFileId) throw new DomainError('invalid_state', 'this image has no poster text');
  const background = await readLogoFile(ctx.orgId, asset.backgroundFileId);
  if (!background) throw new DomainError('not_found', 'background');
  const facts = await loadFacts(ctx, asset.productId);
  const poster = await composePoster(ctx, facts, asset.productId, background.bytes, copy);
  const key = `org/${ctx.orgId}/marketing/${newId()}.webp`;
  await storage().put(key, poster, 'image/webp');
  let oldKey: string | undefined;
  try {
    const row = await db.transaction(async (tx) => {
      const fileId = newId();
      await tx.insert(files).values({ id: fileId, orgId: ctx.orgId, kind: 'marketing_image', storageKey: key, mime: 'image/webp', sizeBytes: poster.byteLength, sha256: createHash('sha256').update(poster).digest('hex'), isAiGenerated: true, createdBy: ctx.userId });
      const [updated] = await tx.update(marketingAssets).set({ fileId, posterCopy: copy }).where(and(eq(marketingAssets.orgId, ctx.orgId), eq(marketingAssets.id, id))).returning();
      const [old] = await tx.delete(files).where(and(eq(files.orgId, ctx.orgId), eq(files.id, asset.fileId))).returning({ key: files.storageKey });
      oldKey = old?.key;
      await recordAudit(tx, who(ctx), { action: 'marketing_asset.text_edited', entityType: 'marketing_asset', entityId: id, summary: { headline: copy.headline.slice(0, 70), showPrice: copy.showPrice, textPosition: copy.textPosition } });
      return updated;
    });
    if (oldKey) await storage().delete(oldKey).catch(() => undefined);
    return row;
  } catch (err) {
    await storage().delete(key).catch(() => undefined);
    throw err;
  }
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
    request: { messages: [{ role: 'developer', content: captionInstructions(facts.locale, asset.purpose, asset.productId === null) }, { role: 'user', content: data }], effort: 'low', maxTokens: 1200 },
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
      posterCopy: marketingAssets.posterCopy,
      // The picture's logo is the product's, else the company's, and can be downloaded on its own.
      hasLogo: sql<boolean>`coalesce(${products.logoFileId}, (select "logo_file_id" from "brand_kits" where "brand_kits"."org_id" = "marketing_assets"."org_id")) is not null`,
      createdBy: marketingAssets.createdBy,
      createdAt: marketingAssets.createdAt,
    })
    .from(marketingAssets)
    .leftJoin(products, and(eq(products.orgId, marketingAssets.orgId), eq(products.id, marketingAssets.productId)))
    .where(and(eq(marketingAssets.orgId, ctx.orgId), f.company ? isNull(marketingAssets.productId) : f.productId ? eq(marketingAssets.productId, f.productId) : undefined, f.purpose ? eq(marketingAssets.purpose, f.purpose) : undefined))
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

/** The logo that sits on this asset's poster (the product's, else the company's), so it can be attached or downloaded on its own. */
export async function readAssetLogo(ctx: Ctx, id: string): Promise<{ bytes: Uint8Array; mime: string; name: string }> {
  assertCan(ctx, 'marketing.use');
  const asset = await loadAsset(ctx, id);
  const logo = await resolveLogo(ctx, asset.productId);
  if (!logo) throw new DomainError('not_found', 'logo');
  return { ...logo, name: `logo-${asset.id}.webp` };
}

/** Owner and Admin delete any asset; Staff only their own (BRD-M10 section 2). Revisions of a deleted image keep standing. */
export async function deleteAsset(ctx: Ctx, id: string): Promise<void> {
  assertCan(ctx, 'marketing.use');
  const asset = await loadAsset(ctx, id);
  if (!can(ctx.role, 'marketing.delete_any') && asset.createdBy !== ctx.userId) throw new DomainError('forbidden', 'only your own assets');
  const keys = await db.transaction(async (tx) => {
    await tx.update(marketingAssets).set({ parentAssetId: null }).where(and(eq(marketingAssets.orgId, ctx.orgId), eq(marketingAssets.parentAssetId, id)));
    await tx.delete(marketingAssets).where(and(eq(marketingAssets.orgId, ctx.orgId), eq(marketingAssets.id, id)));
    // The finished poster and, when there is one, the background it was drawn on.
    const removed = await tx.delete(files).where(and(eq(files.orgId, ctx.orgId), inArray(files.id, [asset.fileId, ...(asset.backgroundFileId ? [asset.backgroundFileId] : [])]))).returning({ key: files.storageKey });
    await recordAudit(tx, who(ctx), { action: 'marketing_asset.deleted', entityType: 'marketing_asset', entityId: id, summary: { productId: asset.productId } });
    return removed.map((f) => f.key);
  });
  await Promise.all(keys.map((key) => storage().delete(key).catch((err) => console.error('marketing image could not be removed from storage', err instanceof Error ? err.message : err))));
}
