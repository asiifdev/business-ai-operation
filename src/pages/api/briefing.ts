import type { APIRoute } from 'astro';
import { z } from 'zod';
import { generateBriefing, getBriefing } from '../../domain/action-center/briefing';
import { handle, ok, rateLimit, readJson, requireCtx } from '../../lib/api';

export const prerender = false;

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export const GET: APIRoute = (context) =>
  handle(async () => {
    const date = context.url.searchParams.get('date');
    return ok(await getBriefing(requireCtx(context), date && ISO.test(date) ? date : undefined));
  });

const bodySchema = z.object({ locale: z.enum(['id', 'en']).optional() });

/** Writes today's briefing now instead of waiting for the briefing hour. A second call returns the same one. */
export const POST: APIRoute = (context) =>
  handle(async () => {
    const ctx = requireCtx(context);
    const limited = rateLimit(ctx, 'briefing', 5, 60_000);
    if (limited) return limited;
    const body = bodySchema.parse(await readJson(context.request));
    return ok({ briefing: await generateBriefing(ctx, { locale: body.locale ?? context.locals.user?.locale ?? 'id' }) });
  });
