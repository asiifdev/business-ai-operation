import type { APIRoute } from 'astro';
import { revokeInvitation } from '../../../../domain/users/invitations';
import { handle, ok, param, requireCtx } from '../../../../lib/api';

export const prerender = false;

/** `DELETE /api/users/invitations/:id`: withdraws an invitation; its link stops working at once. */
export const DELETE: APIRoute = (context) =>
  handle(async () => {
    await revokeInvitation(requireCtx(context), param(context, 'id'));
    return ok({ revoked: true });
  });
