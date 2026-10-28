import type { APIRoute } from 'astro';
import { discardTaskDraft } from '../../../../domain/tasks/service';
import { handle, ok, param, requireCtx } from '../../../../lib/api';

export const prerender = false;

/** Turns down an AI draft. Only drafts can be removed; a real task is closed instead. */
export const POST: APIRoute = (context) =>
  handle(async () => {
    await discardTaskDraft(requireCtx(context), param(context, 'id'));
    return ok({ id: param(context, 'id') });
  });
