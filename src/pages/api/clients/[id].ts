import type { APIRoute } from 'astro';
import { deleteClient, getClient360, updateClient } from '../../../domain/portfolio/clients';
import { handle, ok, param, readJson, requireCtx } from '../../../lib/api';

export const prerender = false;

export const GET: APIRoute = (context) => handle(async () => ok(await getClient360(requireCtx(context), param(context, 'id'))));

export const PATCH: APIRoute = (context) =>
  handle(async () => {
    await updateClient(requireCtx(context), param(context, 'id'), (await readJson(context.request)) as never);
    return ok({ id: param(context, 'id') });
  });

export const DELETE: APIRoute = (context) =>
  handle(async () => {
    await deleteClient(requireCtx(context), param(context, 'id'));
    return ok({ id: param(context, 'id') });
  });
