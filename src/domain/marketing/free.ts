import sharp from 'sharp';
import { z } from 'zod';
import { getAiProvider } from '../../ai';
import type { AiProvider } from '../../ai/provider';
import { chatOnce, editImagesOnce, generateImagesOnce } from '../../ai/run';
import type { InputImage } from '../../ai/types';
import { wrapUntrusted } from '../../ai/untrusted';
import { db } from '../../db/client';
import type { Ctx } from '../ctx';
import { DomainError } from '../errors';
import { assertCan } from '../permissions';
import { sniffImage } from '../portfolio/logo';
import { applyLogo } from './poster';
import { fetchPage } from './page';
import {
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
  briefAnswer,
  briefInstructions,
  briefJsonSchema,
  foreignClaims,
  freeSchema,
  readAnswer,
  readInstructions,
  readJsonSchema,
  refineSchema,
  strictPrompt,
  type FreeInput,
} from './free-rules';
import { ASPECTS, factsText, foreignCaptionFigures } from './rules';
import { imageQuotaStatus, loadAsset, loadFacts, quotaRefusal, readAssetBackground, readAssetFile, resolveLogo, saveCaption, saveImages, type AssetRow, type StudioResult } from './service';

export interface Attachment {
  bytes: Uint8Array;
  name: string;
}

export type FreeResult = StudioResult<{ asset: AssetRow; caption: string | null }>;

const REFERENCE_PIXELS = 1536;

/**
 * Checks and re-encodes what a person attached (D-080): PNG, JPEG or WebP recognised from the first bytes, a few of them,
 * each under 5 MB, scaled down and with metadata dropped. Nothing is stored; the model only looks at them.
 */
export async function prepareAttachments(files: readonly Attachment[]): Promise<Array<InputImage & { name: string }>> {
  if (files.length > MAX_ATTACHMENTS) throw new DomainError('validation', 'attachments:count');
  const out: Array<InputImage & { name: string }> = [];
  for (const file of files) {
    if (file.bytes.byteLength === 0 || file.bytes.byteLength > MAX_ATTACHMENT_BYTES) throw new DomainError('validation', 'attachments:size');
    if (!sniffImage(file.bytes)) throw new DomainError('validation', 'attachments:format');
    try {
      const bytes = await sharp(file.bytes, { limitInputPixels: 40_000_000 }).rotate().resize(REFERENCE_PIXELS, REFERENCE_PIXELS, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 92 }).toBuffer();
      out.push({ bytes: new Uint8Array(bytes), mime: 'image/webp', name: file.name.slice(0, 80) || 'image' });
    } catch {
      throw new DomainError('validation', 'attachments:format');
    }
  }
  return out;
}

/** Every text the model can read on these pictures, so a number in a screenshot is not mistaken for an invented one. */
async function readTexts(ctx: Ctx, provider: AiProvider, images: InputImage[], locale: 'id' | 'en', summary: string): Promise<{ ok: true; text: string[]; runId: string } | { ok: false; kind: string; message: string }> {
  if (images.length === 0) return { ok: true, text: [], runId: '' };
  const out = await chatOnce({
    db,
    ctx,
    provider,
    locale,
    feature: 'agent',
    inputSummary: summary,
    entityType: 'marketing_asset',
    request: { messages: [{ role: 'developer', content: readInstructions }, { role: 'user', content: 'Read the text.', images }], schema: { name: 'visible_text', schema: readJsonSchema as unknown as Record<string, unknown>, strict: true }, effort: 'low', maxTokens: 1500 },
  });
  if (!out.ok) return { ok: false, kind: out.kind, message: out.message };
  let json: unknown = out.value.json;
  if (json === undefined && out.value.text) json = (() => { try { return JSON.parse(out.value.text!); } catch { return undefined; } })();
  const parsed = readAnswer.safeParse(json);
  // A reader that cannot answer means the picture cannot be checked, so it is not shown.
  if (!parsed.success) return { ok: false, kind: 'unverified', message: 'unverified' };
  return { ok: true, text: parsed.data.visibleText, runId: out.runId };
}

const refusal = (kind: string, message: string): StudioResult<never> => ({ ok: false, kind, message });

/**
 * One request in a person's own words, with pictures and a link, that ends in a finished picture (D-080). The company
 * profile and product facts are added, the model looks at the attachments, writes a brief and makes the picture from the
 * attachments as references. Then the finished picture is read back and anything it claims that nobody provided (an offer,
 * a percentage, a date) sends it back once for a plain version, and out if it still carries one. Nothing is published.
 */
export async function createFromPrompt(ctx: Ctx, raw: FreeInput & { logo?: boolean }, files: readonly Attachment[] = [], provider: AiProvider = getAiProvider()): Promise<FreeResult> {
  assertCan(ctx, 'marketing.use');
  const input = freeSchema.parse(raw);
  const references = await prepareAttachments(files);
  const quota = await imageQuotaStatus(ctx);
  if (quota.remaining < 1) return quotaRefusal(quota);

  const productId = input.productId && input.productId !== 'company' ? input.productId : null;
  const facts = await loadFacts(ctx, productId);
  const data = factsText(facts.product, facts.brand);

  let page: Awaited<ReturnType<typeof fetchPage>> | null = null;
  if (input.url) {
    try {
      page = await fetchPage(input.url);
    } catch (err) {
      if (err instanceof DomainError) return refusal('url', err.message);
      throw err;
    }
  }
  const pageText = page ? [page.title, page.description, page.text].filter(Boolean).join('\n') : '';

  // The company or product logo is laid on by code afterwards, never drawn by the model: a model redraws a logo (changes it, adds a plate).
  // Only the person's own attachments go to the model as references, in the order they gave them.
  const logo = raw.logo === false ? null : await resolveLogo(ctx, productId);
  const images: Array<InputImage & { name: string }> = [...references];

  const attachmentRead = await readTexts(ctx, provider, references, facts.locale, 'Teks pada lampiran');
  if (!attachmentRead.ok) return refusal(attachmentRead.kind, attachmentRead.message);
  const sources = [input.prompt, data, pageText, ...attachmentRead.text];

  const brief = await chatOnce({
    db,
    ctx,
    provider,
    locale: facts.locale,
    feature: 'agent',
    inputSummary: 'Brief gambar dari permintaan bebas',
    entityType: 'marketing_asset',
    request: {
      messages: [
        { role: 'developer', content: briefInstructions(facts.locale, images.map((i) => i.name), Boolean(page), Boolean(facts.product.company)) },
        { role: 'user', content: [wrapUntrusted('permintaan pengguna', input.prompt), wrapUntrusted('data perusahaan', data), page ? wrapUntrusted('halaman web', pageText) : ''].filter(Boolean).join('\n\n'), images: images.length ? images : undefined },
      ],
      schema: { name: 'image_brief', schema: briefJsonSchema as unknown as Record<string, unknown>, strict: true },
      effort: 'low',
      maxTokens: 2500,
    },
  });
  if (!brief.ok) return refusal(brief.kind, brief.message);
  let briefJson: unknown = brief.value.json;
  if (briefJson === undefined && brief.value.text) briefJson = (() => { try { return JSON.parse(brief.value.text!); } catch { return undefined; } })();
  const parsedBrief = briefAnswer.safeParse(briefJson);
  if (!parsedBrief.success) return refusal('bad_output', 'bad_output');
  const { imagePrompt, caption: draftCaption } = parsedBrief.data;
  // Only text that is itself backed by a source may be asked for on the picture.
  const allowedText = parsedBrief.data.onImageText.filter((t) => foreignClaims([t], sources).length === 0);

  const size = ASPECTS[input.aspect];
  const make = async (prompt: string) => {
    const request = { prompt, n: 1, size, grounding: false } as const;
    return images.length ? editImagesOnce({ db, ctx, provider, locale: facts.locale, inputSummary: 'Gambar dari permintaan bebas', entityType: 'marketing_asset', request: { ...request, images } }) : generateImagesOnce({ db, ctx, provider, locale: facts.locale, inputSummary: 'Gambar dari permintaan bebas', entityType: 'marketing_asset', request });
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    const made = await make(strictPrompt(logo ? `${imagePrompt}\nReserve the top-left corner as a clean empty margin about 28% of the picture width and 20% of its height: no text, no graphics, no logo and nothing important in it, and start the headline below or to the right of that area. The real logo is added there afterwards.` : imagePrompt, allowedText, attempt > 0));
    if (!made.ok) return refusal(made.kind, made.message);
    const image = made.value.images[0]!;
    const seen = await readTexts(ctx, provider, [{ bytes: image.bytes, mime: image.mime }], facts.locale, 'Teks pada gambar jadi');
    if (!seen.ok) return refusal(seen.kind, seen.message);
    const claims = foreignClaims(seen.text, sources);
    if (claims.length > 0) {
      if (attempt === 0) continue;
      return refusal('unverified', claims.join(', '));
    }
    const [asset] = await saveImages(ctx, { productId, purpose: 'free', prompt: input.prompt, parentAssetId: null, aiRunId: made.runId }, [logo ? { poster: await applyLogo(image.bytes, logo.bytes, 'top_left').catch(() => image.bytes), background: image.bytes } : { poster: image.bytes }]);
    // The caption passes the same guard as everything else; one that carries a claim nobody gave is dropped, not shown.
    const cleanCaption = draftCaption.trim() && foreignCaptionFigures(draftCaption, sources.join('\n')).length === 0 && foreignClaims([draftCaption], sources).length === 0 ? draftCaption.trim().slice(0, 2200) : null;
    if (cleanCaption) await saveCaption(ctx, asset!.id, cleanCaption, made.runId);
    return { ok: true, asset: asset!, caption: cleanCaption };
  }
  return refusal('unverified', 'unverified');
}

/**
 * A change in plain words ("make the headline bigger", "warmer colours"): the picture itself goes back to the model as the
 * reference, so everything not mentioned stays. The old one stays too. The result passes the same check (D-080).
 */
export async function refineFreeAsset(ctx: Ctx, id: string, raw: z.input<typeof refineSchema>, provider: AiProvider = getAiProvider()): Promise<FreeResult> {
  assertCan(ctx, 'marketing.use');
  const { instruction } = refineSchema.parse(raw);
  const parent = await loadAsset(ctx, id);
  if (parent.purpose !== 'free') throw new DomainError('invalid_state', 'not a free asset');
  const quota = await imageQuotaStatus(ctx);
  if (quota.remaining < 1) return quotaRefusal(quota);
  const facts = await loadFacts(ctx, parent.productId);
  // A picture whose logo came from code is edited without the logo and stamped again, so the logo never changes.
  const clean = await readAssetBackground(ctx, id);
  const logo = clean ? await resolveLogo(ctx, parent.productId) : null;
  const file = clean ?? (await readAssetFile(ctx, id));
  const current: InputImage = { bytes: file.bytes, mime: 'image/webp' };

  const before = await readTexts(ctx, provider, [current], facts.locale, 'Teks pada gambar sebelum diubah');
  if (!before.ok) return refusal(before.kind, before.message);
  // What was already on the picture stays legitimate, plus what the person asks for now.
  const sources = [parent.prompt, instruction, factsText(facts.product, facts.brand), ...before.text];
  const prompt = `Edit the given picture as the person asks: ${instruction}\nChange only what was asked and keep everything else, including the logo, exactly the same. Add no new text, numbers, offers or slogans beyond what the person wrote.`;

  const made = await editImagesOnce({ db, ctx, provider, locale: facts.locale, inputSummary: 'Ubah gambar dengan bahasa biasa', entityType: 'marketing_asset', entityId: id, request: { prompt, n: 1, grounding: false, images: [current] } });
  if (!made.ok) return refusal(made.kind, made.message);
  const image = made.value.images[0]!;
  const after = await readTexts(ctx, provider, [{ bytes: image.bytes, mime: image.mime }], facts.locale, 'Teks pada gambar hasil ubah');
  if (!after.ok) return refusal(after.kind, after.message);
  const claims = foreignClaims(after.text, sources);
  if (claims.length > 0) return refusal('unverified', claims.join(', '));
  const [asset] = await saveImages(ctx, { productId: parent.productId, purpose: 'free', prompt: `${parent.prompt}\n→ ${instruction}`, parentAssetId: parent.id, aiRunId: made.runId }, [logo ? { poster: await applyLogo(image.bytes, logo.bytes, 'top_left').catch(() => image.bytes), background: image.bytes } : { poster: image.bytes }]);
  if (parent.caption) await saveCaption(ctx, asset!.id, parent.caption, null);
  return { ok: true, asset: asset!, caption: parent.caption };
}
