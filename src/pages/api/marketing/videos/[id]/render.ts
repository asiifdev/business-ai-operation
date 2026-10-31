import type { APIRoute } from 'astro';
import { requestRender } from '../../../../../domain/marketing/video';
import { handle, ok, param, rateLimit, readJson, requireCtx } from '../../../../../lib/api';

export const prerender = false;

/**
 * `POST /api/marketing/videos/:id/render`: queue the video for a saved script. The body may carry the person's edits to the
 * spoken line and the on-screen text of each scene, the narrator and the shape. Answers at once; the job runs in the background (D-086).
 */
export const POST: APIRoute = (context) =>
  handle(async () => {
    const ctx = requireCtx(context);
    const limited = rateLimit(ctx, 'marketing-video-render', 6, 60_000);
    if (limited) return limited;
    return ok(await requestRender(ctx, param(context, 'id'), (await readJson(context.request)) as never));
  });
