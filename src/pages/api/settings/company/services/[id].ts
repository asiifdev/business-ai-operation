import type { APIRoute } from 'astro';
import { removeService, updateService } from '../../../../../domain/org/profile';
import { handle, ok, readJson, requireCtx } from '../../../../../lib/api';

export const prerender = false;

export const PATCH: APIRoute = (context) =>
  handle(async () => {
    const row = await updateService(requireCtx(context), context.params.id!, (await readJson(context.request)) as never);
    return ok({ id: row.id });
  });

export const DELETE: APIRoute = (context) =>
  handle(async () => {
    await removeService(requireCtx(context), context.params.id!);
    return ok({ removed: true });
  });
