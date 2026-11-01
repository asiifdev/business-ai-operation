import type { APIRoute } from 'astro';
import { dictate } from '../../../domain/assistant/attachments';
import { DomainError } from '../../../domain/errors';
import { handle, ok, rateLimit, requireCtx } from '../../../lib/api';
import { toWavSegments } from '../../../server/audio';

export const prerender = false;

const BIGGEST = 26 * 1024 * 1024;

/**
 * `POST /api/assistant/dictate`: a voice recording (multipart field `audio`) turned into text for the composer. The person reads
 * the words and sends them, so a mis-heard word is fixed before the assistant ever sees it. A recording that cannot be used is a
 * normal answer (`ok: false`, `reason`).
 */
export const POST: APIRoute = (context) =>
  handle(async () => {
    const ctx = requireCtx(context);
    const limited = rateLimit(ctx, 'assistant-dictate', 15, 60_000);
    if (limited) return limited;
    if (Number(context.request.headers.get('content-length') ?? 0) > BIGGEST) return ok({ ok: false, reason: 'size' });
    const form = await context.request.formData().catch(() => null);
    const audio = form?.get('audio');
    if (!(audio instanceof File)) throw new DomainError('validation', 'audio');
    return ok(await dictate(ctx, new Uint8Array(await audio.arrayBuffer()), { toWav: toWavSegments }));
  });
