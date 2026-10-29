import type { APIRoute } from 'astro';
import { deactivateUser } from '../../../../domain/users/service';
import { handle, ok, param, requireCtx } from '../../../../lib/api';

export const prerender = false;

/** `POST /api/users/:id/deactivate`: ends every session at once (BR-M01-06). */
export const POST: APIRoute = (context) =>
  handle(async () => {
    await deactivateUser(requireCtx(context), param(context, 'id'));
    return ok({ id: param(context, 'id') });
  });
