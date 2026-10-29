import type { APIRoute } from 'astro';
import { draftNarrative } from '../../../../domain/documents/narrative';
import { handle, ok, param, rateLimit, requireCtx } from '../../../../lib/api';

export const prerender = false;

/** `POST /api/documents/:id/narrative`: the assistant writes the words of a draft; prices stay as the code computed them. */
export const POST: APIRoute = (context) =>
  handle(async () => {
    const ctx = requireCtx(context);
    const limited = rateLimit(ctx, 'document-narrative', 10, 60_000);
    if (limited) return limited;
    return ok(await draftNarrative(ctx, param(context, 'id')));
  });
