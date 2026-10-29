import type { APIRoute } from 'astro';
import { useTemplate } from '../../../../domain/flows/service';
import { handle, ok, param, readJson, requireCtx } from '../../../../lib/api';

export const prerender = false;

/** `POST /api/flows/templates/:key`: copies a built-in template into the organization's own flows. */
export const POST: APIRoute = (context) =>
  handle(async () => {
    const body = context.request.headers.get('content-type')?.includes('application/json') ? ((await readJson(context.request)) as { name?: string; productId?: string | null }) : {};
    return ok(await useTemplate(requireCtx(context), param(context, 'key'), body), 201);
  });
