import type { APIRoute } from 'astro';
import { z } from 'zod';
import { explainFinding } from '../../../../domain/action-center/explain';
import { handle, ok, param, rateLimit, readJson, requireCtx } from '../../../../lib/api';

export const prerender = false;

const bodySchema = z.object({ force: z.boolean().default(false), locale: z.enum(['id', 'en']).optional() });

/** Asks the AI to explain one finding and draft a client message, once; `force` writes it again (BR-M08-10). */
export const POST: APIRoute = (context) =>
  handle(async () => {
    const ctx = requireCtx(context);
    const limited = rateLimit(ctx, 'finding-explain', 10, 60_000);
    if (limited) return limited;
    const body = bodySchema.parse(await readJson(context.request));
    return ok(await explainFinding(ctx, param(context, 'id'), { force: body.force, locale: body.locale ?? context.locals.user?.locale ?? 'id' }));
  });
