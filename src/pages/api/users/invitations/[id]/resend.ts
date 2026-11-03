import type { APIRoute } from 'astro';
import { resendInvitation } from '../../../../../domain/users/invitations';
import { handle, ok, param, rateLimit, requireCtx } from '../../../../../lib/api';

export const prerender = false;

/** `POST /api/users/invitations/:id/resend`: a new link and a fresh seven days; the old link stops working. */
export const POST: APIRoute = (context) =>
  handle(async () => {
    const ctx = requireCtx(context);
    const limited = rateLimit(ctx, 'invite', 30, 60 * 60_000);
    if (limited) return limited;
    return ok(await resendInvitation(ctx, param(context, 'id')));
  });
