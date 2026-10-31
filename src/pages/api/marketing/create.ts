import type { APIRoute } from 'astro';
import { DomainError } from '../../../domain/errors';
import { createFromPrompt } from '../../../domain/marketing/free';
import { MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES } from '../../../domain/marketing/free-rules';
import { handle, ok, rateLimit, requireCtx } from '../../../lib/api';

export const prerender = false;

/**
 * `POST /api/marketing/create` (multipart): a request in the person's own words, with pictures and a link, that answers
 * with a finished picture (D-080). Fields: `prompt`, `aspect`, `productId`, `url`, `logo` ("0" to leave the logo off) and up
 * to four `files`. Nothing attached is stored. A refusal (quota, safety filter, a claim nobody gave) is a normal answer.
 */
export const POST: APIRoute = (context) =>
  handle(async () => {
    const ctx = requireCtx(context);
    const limited = rateLimit(ctx, 'marketing-create', 6, 60_000);
    if (limited) return limited;
    if (Number(context.request.headers.get('content-length') ?? 0) > MAX_ATTACHMENTS * MAX_ATTACHMENT_BYTES + 256 * 1024) throw new DomainError('validation', 'attachments:size');
    const form = await context.request.formData().catch(() => null);
    if (!form) throw new DomainError('validation', 'form');
    const text = (key: string) => {
      const v = form.get(key);
      return typeof v === 'string' ? v : undefined;
    };
    const files = await Promise.all(form.getAll('files').filter((f): f is File => f instanceof File && f.size > 0).map(async (f) => ({ bytes: new Uint8Array(await f.arrayBuffer()), name: f.name })));
    const result = await createFromPrompt(ctx, { prompt: text('prompt') ?? '', aspect: text('aspect') as never, productId: text('productId') || null, url: text('url'), logo: text('logo') !== '0' }, files);
    return ok(result.ok ? { ok: true, assetId: result.asset.id, caption: result.caption } : result);
  });
