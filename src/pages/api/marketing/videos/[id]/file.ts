import type { APIRoute } from 'astro';
import { readVideoFile } from '../../../../../domain/marketing/video';
import { handle, param, requireCtx } from '../../../../../lib/api';

export const prerender = false;

/**
 * `GET /api/marketing/videos/:id/file`: the MP4. Browsers need byte ranges to play and seek, so a `Range` header is answered
 * with 206. `?download=1` asks the browser to save it.
 */
export const GET: APIRoute = (context) =>
  handle(async () => {
    const file = await readVideoFile(requireCtx(context), param(context, 'id'));
    const total = file.bytes.byteLength;
    const headers: Record<string, string> = { 'content-type': file.mime, 'accept-ranges': 'bytes', 'cache-control': 'private, max-age=3600', 'x-content-type-options': 'nosniff' };
    if (context.url.searchParams.get('download') === '1') headers['content-disposition'] = `attachment; filename="${file.name}"`;
    const range = /^bytes=(\d*)-(\d*)$/.exec(context.request.headers.get('range') ?? '');
    if (range && (range[1] || range[2])) {
      const start = range[1] ? Number(range[1]) : Math.max(0, total - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), total - 1) : total - 1;
      if (start > end || start >= total) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${total}` } });
      return new Response(Buffer.from(file.bytes.subarray(start, end + 1)), { status: 206, headers: { ...headers, 'content-range': `bytes ${start}-${end}/${total}`, 'content-length': String(end - start + 1) } });
    }
    return new Response(Buffer.from(file.bytes), { headers: { ...headers, 'content-length': String(total) } });
  });
