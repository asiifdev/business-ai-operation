import type { APIRoute } from 'astro';
import { acceptTaskDraft } from '../../../../domain/tasks/service';
import { handle, ok, param, requireCtx } from '../../../../lib/api';

export const prerender = false;

export const POST: APIRoute = (context) =>
  handle(async () => {
    await acceptTaskDraft(requireCtx(context), param(context, 'id'));
    return ok({ id: param(context, 'id') });
  });
