import type { APIRoute } from 'astro';
import { z } from 'zod';
import { setClientArchived } from '../../../../domain/portfolio/clients';
import { handle, ok, param, readJson, requireCtx } from '../../../../lib/api';

export const prerender = false;

const body = z.object({ archived: z.boolean() });

export const POST: APIRoute = (context) =>
  handle(async () => {
    const { archived } = body.parse(await readJson(context.request));
    await setClientArchived(requireCtx(context), param(context, 'id'), archived);
    return ok({ id: param(context, 'id'), archived });
  });
