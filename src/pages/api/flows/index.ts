import type { APIRoute } from 'astro';
import { createFlow, listFlows } from '../../../domain/flows/service';
import { handle, ok, readJson, requireCtx } from '../../../lib/api';

export const prerender = false;

export const GET: APIRoute = (context) => handle(async () => ok({ flows: await listFlows(requireCtx(context)) }));

export const POST: APIRoute = (context) => handle(async () => ok(await createFlow(requireCtx(context), (await readJson(context.request)) as never), 201));
