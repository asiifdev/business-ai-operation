import type { APIRoute } from 'astro';
import { addService } from '../../../../../domain/org/profile';
import { handle, ok, readJson, requireCtx } from '../../../../../lib/api';

export const prerender = false;

/** `POST /api/settings/company/services`: adds a service the company offers beyond its products. Owner and Admin. */
export const POST: APIRoute = (context) =>
  handle(async () => {
    const row = await addService(requireCtx(context), (await readJson(context.request)) as never);
    return ok({ id: row.id }, 201);
  });
