import type { APIRoute } from 'astro';
import { readAssetFile } from '../../../../../domain/marketing/service';
import { handle, param, requireCtx } from '../../../../../lib/api';

export const prerender = false;

/** `GET /api/marketing/assets/:id/file`: the picture. `?download=1` asks the browser to save it (BRD-M10 section 9). */
export const GET: APIRoute = (context) =>
  handle(async () => {
    const file = await readAssetFile(requireCtx(context), param(context, 'id'));
    const headers: Record<string, string> = { 'content-type': file.mime, 'cache-control': 'private, max-age=3600', 'x-content-type-options': 'nosniff' };
    if (context.url.searchParams.get('download') === '1') headers['content-disposition'] = `attachment; filename="${file.name}"`;
    return new Response(Buffer.from(file.bytes), { headers });
  });
