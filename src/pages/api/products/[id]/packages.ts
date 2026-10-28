import type { APIRoute } from 'astro';
import { createPackage } from '../../../../domain/portfolio/products';
import { handle, ok, param, readJson, requireCtx } from '../../../../lib/api';

export const prerender = false;

export const POST: APIRoute = (context) =>
  handle(async () => ok(await createPackage(requireCtx(context), param(context, 'id'), (await readJson(context.request)) as never), 201));
