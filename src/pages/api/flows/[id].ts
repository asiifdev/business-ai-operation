import type { APIRoute } from 'astro';
import { archiveFlow, getFlow, updateFlow } from '../../../domain/flows/service';
import { handle, ok, param, readJson, requireCtx } from '../../../lib/api';

export const prerender = false;

export const GET: APIRoute = (context) =>
  handle(async () => {
    const v = Number(context.url.searchParams.get('version'));
    return ok(await getFlow(requireCtx(context), param(context, 'id'), Number.isInteger(v) && v > 0 ? v : undefined));
  });

export const PATCH: APIRoute = (context) => handle(async () => ok(await updateFlow(requireCtx(context), param(context, 'id'), (await readJson(context.request)) as never)));

export const DELETE: APIRoute = (context) =>
  handle(async () => {
    await archiveFlow(requireCtx(context), param(context, 'id'));
    return ok({ id: param(context, 'id') });
  });
