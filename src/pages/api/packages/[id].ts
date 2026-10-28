import type { APIRoute } from 'astro';
import { updatePackage } from '../../../domain/portfolio/products';
import { handle, ok, param, readJson, requireCtx } from '../../../lib/api';

export const prerender = false;

export const PATCH: APIRoute = (context) =>
  handle(async () => {
    await updatePackage(requireCtx(context), param(context, 'id'), (await readJson(context.request)) as never);
    return ok({ id: param(context, 'id') });
  });
