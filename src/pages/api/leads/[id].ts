import type { APIRoute } from 'astro';
import { getLead, updateLead } from '../../../domain/pipeline/leads';
import { handle, ok, param, readJson, requireCtx } from '../../../lib/api';

export const prerender = false;

export const GET: APIRoute = (context) => handle(async () => ok(await getLead(requireCtx(context), param(context, 'id'))));

export const PATCH: APIRoute = (context) =>
  handle(async () => {
    await updateLead(requireCtx(context), param(context, 'id'), (await readJson(context.request)) as never);
    return ok({ id: param(context, 'id') });
  });
