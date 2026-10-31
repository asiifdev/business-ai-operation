import type { APIRoute } from 'astro';
import { removeAttachment } from '../../../../domain/assistant/attachments';
import { handle, ok, param, requireCtx } from '../../../../lib/api';

export const prerender = false;

/** Takes back an attachment that is not in a conversation yet (the cross on its chip). */
export const DELETE: APIRoute = (context) =>
  handle(async () => {
    await removeAttachment(requireCtx(context), param(context, 'id'));
    return ok({ removed: true });
  });
