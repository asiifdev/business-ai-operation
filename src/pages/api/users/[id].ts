import type { APIRoute } from 'astro';
import { z } from 'zod';
import { deleteUserPermanently, setUserRole } from '../../../domain/users/service';
import { handle, ok, param, readJson, requireCtx } from '../../../lib/api';

export const prerender = false;

const body = z.object({ role: z.enum(['owner', 'admin', 'staff']) });

export const PATCH: APIRoute = (context) =>
  handle(async () => {
    const { role } = body.parse(await readJson(context.request));
    await setUserRole(requireCtx(context), param(context, 'id'), role);
    return ok({ id: param(context, 'id') });
  });

/** `DELETE /api/users/:id`: removes a deactivated person for good (Owner only). Refused with `has_history` when records point at them (D-097). */
export const DELETE: APIRoute = (context) =>
  handle(async () => {
    await deleteUserPermanently(requireCtx(context), param(context, 'id'));
    return ok({ id: param(context, 'id') });
  });
