import type { APIRoute } from 'astro';
import { updatePosterCopy } from '../../../../../domain/marketing/service';
import { handle, ok, param, rateLimit, readJson, requireCtx } from '../../../../../lib/api';

export const prerender = false;

/** `PUT /api/marketing/assets/:id/text`: new words or layout for a poster, drawn again from its saved background. No AI call. */
export const PUT: APIRoute = (context) =>
  handle(async () => {
    const ctx = requireCtx(context);
    const limited = rateLimit(ctx, 'marketing-text', 30, 60_000);
    if (limited) return limited;
    const row = await updatePosterCopy(ctx, param(context, 'id'), (await readJson(context.request)) as never);
    return ok({ id: row.id, posterCopy: row.posterCopy });
  });
