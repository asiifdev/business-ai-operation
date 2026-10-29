import type { APIRoute } from 'astro';
import { retryRun } from '../../../../domain/flows/service';
import { handle, ok, param, requireCtx } from '../../../../lib/api';

export const prerender = false;

export const POST: APIRoute = (context) =>
  handle(async () => {
    await retryRun(requireCtx(context), param(context, 'id'));
    return ok({ id: param(context, 'id') });
  });
