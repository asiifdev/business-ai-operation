import type { APIRoute } from 'astro';
import { generateAssets, listAssets } from '../../../../domain/marketing/service';
import { PURPOSES, type Purpose } from '../../../../domain/marketing/rules';
import { handle, ok, rateLimit, readJson, requireCtx } from '../../../../lib/api';

export const prerender = false;

export const GET: APIRoute = (context) =>
  handle(async () => {
    const q = context.url.searchParams;
    const purpose = q.get('purpose');
    return ok({ assets: await listAssets(requireCtx(context), { productId: q.get('productId') ?? undefined, purpose: PURPOSES.includes(purpose as Purpose) ? (purpose as Purpose) : undefined }) });
  });

/** `POST /api/marketing/assets`: makes one to four images for a product. Quota and AI budget are checked inside. */
export const POST: APIRoute = (context) =>
  handle(async () => {
    const ctx = requireCtx(context);
    const limited = rateLimit(ctx, 'marketing-generate', 6, 60_000);
    if (limited) return limited;
    return ok(await generateAssets(ctx, (await readJson(context.request)) as never), 201);
  });
