import type { APIRoute } from 'astro';
import { brandKitDefaults, getBrandKit, hasCompanyLogo, imageQuotaStatus, listStudioProducts } from '../../../domain/marketing/service';
import { handle, ok, requireCtx } from '../../../lib/api';

export const prerender = false;

/** `GET /api/marketing/options`: what the studio form needs: products, the brand kit, and how many images are left today. */
export const GET: APIRoute = (context) =>
  handle(async () => {
    const ctx = requireCtx(context);
    const [products, brandKit, quota, companyLogo, brandDefaults] = await Promise.all([listStudioProducts(ctx), getBrandKit(ctx), imageQuotaStatus(ctx), hasCompanyLogo(ctx), brandKitDefaults(ctx)]);
    return ok({ products, brandKit, quota, companyLogo, brandDefaults });
  });
