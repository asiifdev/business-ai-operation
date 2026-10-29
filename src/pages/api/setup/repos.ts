import type { APIRoute } from 'astro';
import { listConnectionRepos } from '../../../domain/setup/profiles';
import { handle, ok, rateLimit, requireCtx } from '../../../lib/api';
import { DomainError } from '../../../domain/errors';

export const prerender = false;

/** `GET /api/setup/repos?connectionId=`: repository names of one GitHub connection, for the profile form. */
export const GET: APIRoute = (context) =>
  handle(async () => {
    const ctx = requireCtx(context);
    const limited = rateLimit(ctx, 'setup-repos', 20, 60_000);
    if (limited) return limited;
    const id = context.url.searchParams.get('connectionId');
    if (!id) throw new DomainError('validation', 'connectionId');
    return ok({ repos: await listConnectionRepos(ctx, id) });
  });
