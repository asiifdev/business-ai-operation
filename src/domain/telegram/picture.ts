import sharp from 'sharp';
import type { AiProvider } from '../../ai/provider';
import type { Ctx } from '../ctx';
import { DomainError } from '../errors';
import { createFromPrompt, type Attachment } from '../marketing/free';
import { MAX_ATTACHMENTS } from '../marketing/free-rules';
import { readAssetFile } from '../marketing/service';

/** Photos a person sent that still wait for their words (D-080): kept this long, per chat, in memory like the chat history. */
const PENDING_TTL_MS = 10 * 60_000;

export class PendingPictures {
  private readonly byChat = new Map<number, { files: Attachment[]; at: number }>();

  private live(chatId: number, now: Date) {
    const entry = this.byChat.get(chatId);
    if (!entry) return null;
    if (now.getTime() - entry.at > PENDING_TTL_MS) {
      this.byChat.delete(chatId);
      return null;
    }
    return entry;
  }

  /** Adds a photo; at most four are kept (the newest). Returns how many wait now. */
  add(chatId: number, file: Attachment, now: Date): number {
    for (const [id, e] of this.byChat) if (now.getTime() - e.at > PENDING_TTL_MS) this.byChat.delete(id);
    const files = [...(this.live(chatId, now)?.files ?? []), file].slice(-MAX_ATTACHMENTS);
    this.byChat.set(chatId, { files, at: now.getTime() });
    return files.length;
  }

  has(chatId: number, now: Date): boolean {
    return this.live(chatId, now) !== null;
  }

  /** The waiting photos, which are then forgotten. */
  take(chatId: number, now: Date): Attachment[] {
    const files = this.live(chatId, now)?.files ?? [];
    this.byChat.delete(chatId);
    return files;
  }
}

export const pendingPictures = new PendingPictures();

export type PictureResult =
  | { ok: true; jpeg: Uint8Array; assetId: string; caption: string | null }
  | { ok: false; reason: 'quota' | 'unverified' | 'url' | 'failed'; message: string };

/** Telegram only takes JPEG or PNG for a photo, so the WebP the model made is converted. */
export async function pictureJpeg(ctx: Ctx, assetId: string): Promise<Uint8Array> {
  const file = await readAssetFile(ctx, assetId);
  return sharp(file.bytes).flatten({ background: '#ffffff' }).jpeg({ quality: 90 }).toBuffer();
}

/**
 * One finished picture from a person's words and the photos they sent, made by the same service as the web (quota, AI
 * budget, claim check and audit all apply). Portrait, the shape a phone feed likes.
 */
export async function makePicture(ctx: Ctx, prompt: string, files: Attachment[], provider?: AiProvider): Promise<PictureResult> {
  try {
    const made = await createFromPrompt(ctx, { prompt, aspect: 'portrait', logo: true }, files, provider);
    if (!made.ok) return { ok: false, reason: made.kind === 'quota' ? 'quota' : made.kind === 'unverified' ? 'unverified' : made.kind === 'url' ? 'url' : 'failed', message: made.message };
    return { ok: true, jpeg: await pictureJpeg(ctx, made.asset.id), assetId: made.asset.id, caption: made.caption };
  } catch (err) {
    if (err instanceof DomainError && err.code === 'validation') return { ok: false, reason: 'failed', message: err.message };
    throw err;
  }
}
