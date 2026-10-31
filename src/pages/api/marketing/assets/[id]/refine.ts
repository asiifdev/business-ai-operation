import type { APIRoute } from 'astro';
import { refineFreeAsset } from '../../../../../domain/marketing/free';
import { handle, ok, param, rateLimit, readJson, requireCtx } from '../../../../../lib/api';

export const prerender = false;

/** `POST`: changes a picture made from a plain request by saying what to change; the picture itself is the reference (D-080). */
export const POST: APIRoute = (context) =>
  handle(async () => {
    const ctx = requireCtx(context);
    const limited = rateLimit(ctx, 'marketing-refine', 8, 60_000);
    if (limited) return limited;
    const result = await refineFreeAsset(ctx, param(context, 'id'), (await readJson(context.request)) as never);
    return ok(result.ok ? { ok: true, assetId: result.asset.id, caption: result.caption } : result);
  });
