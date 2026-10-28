import type { APIRoute } from 'astro';
import { z } from 'zod';
import { archiveProduct, unarchiveProduct } from '../../../../domain/portfolio/products';
import { handle, ok, param, readJson, requireCtx } from '../../../../lib/api';

export const prerender = false;

const body = z.object({ archived: z.boolean() });

/** Archives or restores a product. Products with history are archived, never deleted. */
export const POST: APIRoute = (context) =>
  handle(async () => {
    const { archived } = body.parse(await readJson(context.request));
    const ctx = requireCtx(context);
    await (archived ? archiveProduct(ctx, param(context, 'id')) : unarchiveProduct(ctx, param(context, 'id')));
    return ok({ id: param(context, 'id'), archived });
  });
