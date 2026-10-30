import type { APIRoute } from 'astro';
import { getLeadFormOptions } from '../../../domain/pipeline/leads';
import { handle, ok, requireCtx } from '../../../lib/api';

export const prerender = false;

/** `GET /api/leads/options`: people a lead can be assigned to. */
export const GET: APIRoute = (context) => handle(async () => ok(await getLeadFormOptions(requireCtx(context))));
