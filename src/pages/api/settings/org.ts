import type { APIRoute } from 'astro';
import { getOrgSettings, updateOrgSettings } from '../../../domain/org/settings';
import { handle, ok, readJson, requireCtx } from '../../../lib/api';

export const prerender = false;

export const GET: APIRoute = (context) => handle(async () => ok(await getOrgSettings(requireCtx(context))));

/** `POST /api/settings/org`: Owner only (BR-M01-07). */
export const POST: APIRoute = (context) => handle(async () => ok(await updateOrgSettings(requireCtx(context), (await readJson(context.request)) as never)));
