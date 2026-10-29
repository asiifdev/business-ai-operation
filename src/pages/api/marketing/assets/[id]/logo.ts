import type { APIRoute } from 'astro';
import { readAssetLogo } from '../../../../../domain/marketing/service';
import { handle, param, requireCtx } from '../../../../../lib/api';

export const prerender = false;

/** `GET /api/marketing/assets/:id/logo`: the logo on this poster, to attach or download on its own. `?download=1` saves it. */
export const GET: APIRoute = (context) =>
  handle(async () => {
    const logo = await readAssetLogo(requireCtx(context), param(context, 'id'));
    const headers: Record<string, string> = { 'content-type': logo.mime, 'cache-control': 'private, max-age=60', 'x-content-type-options': 'nosniff' };
    if (context.url.searchParams.get('download') === '1') headers['content-disposition'] = `attachment; filename="${logo.name}"`;
    return new Response(Buffer.from(logo.bytes), { headers });
  });
