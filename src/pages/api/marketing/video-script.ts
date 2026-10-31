import type { APIRoute } from 'astro';
import { draftVideoScript } from '../../../domain/marketing/service';
import { handle, ok, rateLimit, readJson, requireCtx } from '../../../lib/api';

export const prerender = false;

/** `POST /api/marketing/video-script`: a written script and storyboard from the company and product facts (D-079). Text only; not stored. */
export const POST: APIRoute = (context) =>
  handle(async () => {
    const ctx = requireCtx(context);
    const limited = rateLimit(ctx, 'marketing-video-script', 6, 60_000);
    if (limited) return limited;
    return ok(await draftVideoScript(ctx, (await readJson(context.request)) as never));
  });
