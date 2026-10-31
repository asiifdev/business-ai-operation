import type { APIRoute } from 'astro';
import { undoApproval } from '../../../../domain/action-center/autonomy';
import { handle, ok, param, requireCtx } from '../../../../lib/api';

export const prerender = false;

/** Takes back an action the assistant ran by itself (D-082). `{ undone: false, reason }` when it cannot be taken back any more. */
export const POST: APIRoute = (context) => handle(async () => ok(await undoApproval(requireCtx(context), param(context, 'id'))));
