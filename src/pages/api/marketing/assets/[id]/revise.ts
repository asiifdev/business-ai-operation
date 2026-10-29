import type { APIRoute } from 'astro';
import { reviseAsset } from '../../../../../domain/marketing/service';
import { handle, ok, param, rateLimit, readJson, requireCtx } from '../../../../../lib/api';

export const prerender = false;

/** `POST /api/marketing/assets/:id/revise`: a new image from the old prompt plus an instruction; the old one stays. */
export const POST: APIRoute = (context) =>
  handle(async () => {
    const ctx = requireCtx(context);
    const limited = rateLimit(ctx, 'marketing-generate', 6, 60_000);
    if (limited) return limited;
    return ok(await reviseAsset(ctx, param(context, 'id'), (await readJson(context.request)) as never), 201);
  });
