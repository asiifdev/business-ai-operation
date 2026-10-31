import type { APIRoute } from 'astro';
import { getAutonomy, setAutonomy } from '../../../domain/action-center/autonomy';
import { handle, ok, readJson, requireCtx } from '../../../lib/api';

export const prerender = false;

export const GET: APIRoute = (context) => handle(async () => ok({ level: await getAutonomy(requireCtx(context).orgId) }));

/** `POST /api/settings/autonomy`: Owner only (D-082). */
export const POST: APIRoute = (context) => handle(async () => ok(await setAutonomy(requireCtx(context), (await readJson(context.request)) as never)));
