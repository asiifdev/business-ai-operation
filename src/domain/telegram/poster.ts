import sharp from 'sharp';
import type { AiProvider } from '../../ai/provider';
import { POSTER_PURPOSE_CODE, encodePosterMake, encodePosterPick, type PosterPurpose } from '../../integrations/telegram/callback';
import type { InlineKeyboard } from '../../integrations/telegram/client';
import { escapeHtml } from '../../integrations/telegram/text';
import { translate, type Locale, type MessageKey } from '../../lib/i18n';
import type { Ctx } from '../ctx';
import { assertCan } from '../permissions';
import { draftCaption, generateAssets, listStudioProducts, readAssetFile } from '../marketing/service';

const PURPOSE_KEY: Record<PosterPurpose, MessageKey> = { launch: 'mkPurposeLaunch', promo: 'mkPurposePromo', education: 'mkPurposeEducation', release: 'mkPurposeRelease', brand: 'mkPurposeBrand' };

/** Telegram shows at most this many products as buttons; the rest are one tap away on the web. */
const MAX_PRODUCT_BUTTONS = 8;

/** Who the poster can be about: the company, or one of the active products (D-066). */
export async function posterScopeKeyboard(ctx: Ctx, locale: Locale): Promise<InlineKeyboard> {
  assertCan(ctx, 'marketing.use');
  const products = (await listStudioProducts(ctx)).slice(0, MAX_PRODUCT_BUTTONS);
  return {
    inline_keyboard: [
      [{ text: translate(locale, 'mkScopeCompany'), callback_data: encodePosterPick('o') }],
      ...products.map((p) => [{ text: p.name.slice(0, 40), callback_data: encodePosterPick(p.id) }]),
    ],
  };
}

export function posterPurposeKeyboard(scope: string, locale: Locale): InlineKeyboard {
  const purposes = (Object.keys(POSTER_PURPOSE_CODE) as PosterPurpose[]).filter((p) => scope !== 'o' ? p !== 'brand' : p === 'brand' || p === 'promo' || p === 'launch');
  return { inline_keyboard: purposes.map((p) => [{ text: translate(locale, PURPOSE_KEY[p]), callback_data: encodePosterMake(scope, p) }]) };
}

export type PosterResult =
  | { ok: true; jpeg: Uint8Array; assetId: string; caption: string | null }
  | { ok: false; reason: 'quota' | 'foreign_figures' | 'failed'; message: string };

/**
 * One poster, made by the same service as the web (quota, AI budget, number check and audit all apply), with the real logo
 * on it. The caption comes from the same caption service; when it is refused for an invented figure the poster still goes
 * out and the person writes the caption themselves. Telegram only takes JPEG or PNG for a photo, so the WebP is converted.
 */
export async function makePoster(ctx: Ctx, scope: string, purpose: PosterPurpose, provider?: AiProvider): Promise<PosterResult> {
  const made = await generateAssets(ctx, { productId: scope === 'o' ? null : scope, purpose, variants: 1, aspect: 'portrait', logo: true, corner: 'bottom_right' }, provider);
  if (!made.ok) return { ok: false, reason: made.kind === 'quota' ? 'quota' : 'failed', message: made.message };
  const asset = made.assets[0];
  const file = await readAssetFile(ctx, asset.id);
  const jpeg = await sharp(file.bytes).flatten({ background: '#ffffff' }).jpeg({ quality: 90 }).toBuffer();
  const caption = await draftCaption(ctx, asset.id, provider);
  return { ok: true, jpeg, assetId: asset.id, caption: caption.ok ? caption.caption : null };
}

export const posterText = (locale: Locale, key: MessageKey, vars?: Record<string, string | number>) => escapeHtml(translate(locale, key, vars));
