import type { APIRoute } from 'astro';
import { getConversionPlan } from '../../../../domain/pipeline/leads';
import { handle, ok, param, requireCtx } from '../../../../lib/api';

export const prerender = false;

/** `GET /api/leads/:id/conversion-plan`: the package lines of the lead's final proposal that can become subscriptions (D-093). */
export const GET: APIRoute = (context) => handle(async () => ok(await getConversionPlan(requireCtx(context), param(context, 'id'))));
