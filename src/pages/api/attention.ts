import type { APIRoute } from 'astro';
import { getAttentionCounts } from '../../domain/dashboard/overview';
import { handle, ok, requireCtx } from '../../lib/api';

export const prerender = false;

/** `GET /api/attention`: what needs a person's attention, so the sidebar pills and the bell refresh after an action. */
export const GET: APIRoute = (context) => handle(async () => ok(await getAttentionCounts(requireCtx(context))));
