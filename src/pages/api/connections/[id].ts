import type { APIRoute } from 'astro';
import { deleteConnection, getConnection, updateConnection } from '../../../domain/connections/service';
import { handle, ok, param, readJson, requireCtx } from '../../../lib/api';

export const prerender = false;

export const GET: APIRoute = (context) => handle(async () => ok(await getConnection(requireCtx(context), param(context, 'id'))));

export const PATCH: APIRoute = (context) =>
  handle(async () => {
    await updateConnection(requireCtx(context), param(context, 'id'), (await readJson(context.request)) as never);
    return ok({ id: param(context, 'id') });
  });

export const DELETE: APIRoute = (context) =>
  handle(async () => {
    await deleteConnection(requireCtx(context), param(context, 'id'));
    return ok({ id: param(context, 'id') });
  });
