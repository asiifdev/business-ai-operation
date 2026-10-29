import type { APIRoute } from 'astro';
import { auth } from '../../../auth/auth';
import { changeOwnPassword } from '../../../domain/users/profile';
import { handle, ok, rateLimit, readJson, requireCtx } from '../../../lib/api';

export const prerender = false;

/** `POST /api/profile/password`: the signed-in person changes their own password; their other sessions end. */
export const POST: APIRoute = (context) =>
  handle(async () => {
    const ctx = requireCtx(context);
    const limited = rateLimit(ctx, 'change-password', 5, 60_000);
    if (limited) return limited;
    const session = await auth.api.getSession({ headers: context.request.headers });
    await changeOwnPassword(ctx, (await readJson(context.request)) as never, session?.session.id);
    return ok({ changed: true });
  });
