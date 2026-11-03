import type { APIRoute } from 'astro';
import { createProduct, listProducts } from '../../../domain/portfolio/products';
import { handle, ok, readJson, requireCtx } from '../../../lib/api';

export const prerender = false;

export const GET: APIRoute = (context) =>
  handle(async () => ok({ products: await listProducts(requireCtx(context), { includeArchived: context.url.searchParams.get('archived') === '1' }) }));

/** `POST /api/products`: a product, optionally with its first packages (`packages`), saved in one transaction. */
export const POST: APIRoute = (context) =>
  handle(async () => {
    const { packages, ...product } = (await readJson(context.request)) as { packages?: never[] } & Record<string, unknown>;
    return ok(await createProduct(requireCtx(context), product as never, packages ?? []), 201);
  });
