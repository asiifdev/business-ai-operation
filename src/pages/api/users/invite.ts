import type { APIRoute } from 'astro';
import { inviteUser } from '../../../domain/users/invitations';
import { handle, ok, rateLimit, readJson, requireCtx } from '../../../lib/api';

export const prerender = false;

/** `POST /api/users/invite`: invites a colleague by email. Answers whether the email went out, and the link when it did not. */
export const POST: APIRoute = (context) =>
  handle(async () => {
    const ctx = requireCtx(context);
    const limited = rateLimit(ctx, 'invite', 30, 60 * 60_000);
    if (limited) return limited;
    return ok(await inviteUser(ctx, (await readJson(context.request)) as never), 201);
  });
