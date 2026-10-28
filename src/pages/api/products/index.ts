import type { APIRoute } from 'astro';
import { createProduct, listProducts } from '../../../domain/portfolio/products';
import { handle, ok, readJson, requireCtx } from '../../../lib/api';

export const prerender = false;

export const GET: APIRoute = (context) =>
  handle(async () => ok({ products: await listProducts(requireCtx(context), { includeArchived: context.url.searchParams.get('archived') === '1' }) }));

export const POST: APIRoute = (context) =>
  handle(async () => ok(await createProduct(requireCtx(context), (await readJson(context.request)) as never), 201));
