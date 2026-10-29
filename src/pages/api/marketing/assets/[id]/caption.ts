import type { APIRoute } from 'astro';
import { draftCaption, updateCaption } from '../../../../../domain/marketing/service';
import { handle, ok, param, rateLimit, readJson, requireCtx } from '../../../../../lib/api';

export const prerender = false;

/** `POST`: the assistant drafts a caption from the product's facts. `PUT`: a person saves their own text. */
export const POST: APIRoute = (context) =>
  handle(async () => {
    const ctx = requireCtx(context);
    const limited = rateLimit(ctx, 'marketing-caption', 10, 60_000);
    if (limited) return limited;
    return ok(await draftCaption(ctx, param(context, 'id')));
  });

export const PUT: APIRoute = (context) =>
  handle(async () => {
    await updateCaption(requireCtx(context), param(context, 'id'), (await readJson(context.request)) as never);
    return ok({ id: param(context, 'id') });
  });
