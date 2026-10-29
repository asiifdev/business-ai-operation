import type { APIRoute } from 'astro';
import { getBrandKit, imageQuotaStatus, listStudioProducts } from '../../../domain/marketing/service';
import { handle, ok, requireCtx } from '../../../lib/api';

export const prerender = false;

/** `GET /api/marketing/options`: what the studio form needs: products, the brand kit, and how many images are left today. */
export const GET: APIRoute = (context) =>
  handle(async () => {
    const ctx = requireCtx(context);
    const [products, brandKit, quota] = await Promise.all([listStudioProducts(ctx), getBrandKit(ctx), imageQuotaStatus(ctx)]);
    return ok({ products, brandKit, quota });
  });
