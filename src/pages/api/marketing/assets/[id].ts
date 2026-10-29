import type { APIRoute } from 'astro';
import { deleteAsset, getAsset } from '../../../../domain/marketing/service';
import { handle, ok, param, requireCtx } from '../../../../lib/api';

export const prerender = false;

export const GET: APIRoute = (context) => handle(async () => ok(await getAsset(requireCtx(context), param(context, 'id'))));

export const DELETE: APIRoute = (context) =>
  handle(async () => {
    await deleteAsset(requireCtx(context), param(context, 'id'));
    return ok({ id: param(context, 'id') });
  });
