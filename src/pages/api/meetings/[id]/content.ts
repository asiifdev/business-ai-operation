import type { APIRoute } from 'astro';
import { deleteMeetingContent } from '../../../../domain/meetings/service';
import { handle, ok, param, requireCtx } from '../../../../lib/api';

export const prerender = false;

/** `DELETE`: the recording and its transcript go together, in one action (BR-M09-10). Minutes and drafts stay. */
export const DELETE: APIRoute = (context) =>
  handle(async () => {
    await deleteMeetingContent(requireCtx(context), param(context, 'id'));
    return ok({ id: param(context, 'id') });
  });
