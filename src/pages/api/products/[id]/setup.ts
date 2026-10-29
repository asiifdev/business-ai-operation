import type { APIRoute } from 'astro';
import { getSetupProfile, saveSetupProfile } from '../../../../domain/setup/profiles';
import { handle, ok, param, readJson, requireCtx } from '../../../../lib/api';

export const prerender = false;

export const GET: APIRoute = (context) => handle(async () => ok(await getSetupProfile(requireCtx(context), param(context, 'id'))));

export const PUT: APIRoute = (context) => handle(async () => ok(await saveSetupProfile(requireCtx(context), param(context, 'id'), (await readJson(context.request)) as never)));
