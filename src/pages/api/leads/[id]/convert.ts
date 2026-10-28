import type { APIRoute } from 'astro';
import { z } from 'zod';
import { convertLeadToClient } from '../../../../domain/pipeline/leads';
import { handle, ok, param, readJson, requireCtx } from '../../../../lib/api';

export const prerender = false;

const body = z.object({
  /** The person confirmed on screen. Without it nothing is created (BR-M04-04). */
  confirm: z.literal(true),
  mode: z.enum(['create', 'link']),
  clientId: z.string().min(1).optional(),
});

/** `POST /api/leads/:id/convert`: a won lead becomes a client, or is linked to an existing one when the name is taken. */
export const POST: APIRoute = (context) =>
  handle(async () => {
    const ctx = requireCtx(context);
    const input = body.parse(await readJson(context.request));
    if (input.mode === 'link' && !input.clientId) return ok({ error: 'validation' }, 400);
    const result = await convertLeadToClient(ctx, param(context, 'id'), input.mode === 'link' ? { mode: 'link', clientId: input.clientId! } : { mode: 'create' }, { locale: context.locals.user?.locale === 'en' ? 'en' : 'id' });
    return ok(result);
  });
