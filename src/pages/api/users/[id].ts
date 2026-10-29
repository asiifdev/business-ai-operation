import type { APIRoute } from 'astro';
import { z } from 'zod';
import { setUserRole } from '../../../domain/users/service';
import { handle, ok, param, readJson, requireCtx } from '../../../lib/api';

export const prerender = false;

const body = z.object({ role: z.enum(['owner', 'admin', 'staff']) });

export const PATCH: APIRoute = (context) =>
  handle(async () => {
    const { role } = body.parse(await readJson(context.request));
    await setUserRole(requireCtx(context), param(context, 'id'), role);
    return ok({ id: param(context, 'id') });
  });
