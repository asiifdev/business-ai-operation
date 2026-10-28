import type { APIRoute } from 'astro';
import { deleteProduct, getProduct, updateProduct } from '../../../domain/portfolio/products';
import { handle, ok, param, readJson, requireCtx } from '../../../lib/api';

export const prerender = false;

export const GET: APIRoute = (context) => handle(async () => ok(await getProduct(requireCtx(context), param(context, 'id'))));

export const PATCH: APIRoute = (context) =>
  handle(async () => {
    await updateProduct(requireCtx(context), param(context, 'id'), (await readJson(context.request)) as never);
    return ok({ id: param(context, 'id') });
  });

export const DELETE: APIRoute = (context) =>
  handle(async () => {
    await deleteProduct(requireCtx(context), param(context, 'id'));
    return ok({ id: param(context, 'id') });
  });
