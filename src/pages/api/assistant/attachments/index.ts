import type { APIRoute } from 'astro';
import { z } from 'zod';
import { addAttachment } from '../../../../domain/assistant/attachments';
import { DomainError } from '../../../../domain/errors';
import { handle, ok, rateLimit, readJson, requireCtx } from '../../../../lib/api';
import { toWavSegments } from '../../../../server/audio';

export const prerender = false;

const urlSchema = z.object({ url: z.string().trim().url().max(500) });
const BIGGEST = 41 * 1024 * 1024;

/**
 * `POST /api/assistant/attachments` (D-083): one file (multipart field `file`) or one link (JSON `{ url }`) for the assistant to
 * read. It is read now into a summary and a digest; the original is not kept. A file that cannot be read is a normal answer
 * (`ok: false`, `reason`), not an HTTP error.
 */
export const POST: APIRoute = (context) =>
  handle(async () => {
    const ctx = requireCtx(context);
    const limited = rateLimit(ctx, 'assistant-attach', 12, 60_000);
    if (limited) return limited;
    if ((context.request.headers.get('content-type') ?? '').includes('application/json')) {
      const { url } = urlSchema.parse(await readJson(context.request));
      const r = await addAttachment(ctx, { url });
      return ok(r);
    }
    if (Number(context.request.headers.get('content-length') ?? 0) > BIGGEST) return ok({ ok: false, reason: 'size', message: 'size' });
    const form = await context.request.formData().catch(() => null);
    const file = form?.get('file');
    if (!(file instanceof File)) throw new DomainError('validation', 'file');
    return ok(await addAttachment(ctx, { file: { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) } }, { toWav: toWavSegments }));
  });
