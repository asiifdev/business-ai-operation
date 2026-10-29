import type { APIRoute } from 'astro';
import { DomainError } from '../../../domain/errors';
import { detectRepoVersion } from '../../../domain/setup/profiles';
import { handle, ok, rateLimit, requireCtx } from '../../../lib/api';

export const prerender = false;

/** `GET /api/setup/version?connectionId=&repo=`: the latest release or tag of a repository, as a suggestion for the product version. */
export const GET: APIRoute = (context) =>
  handle(async () => {
    const ctx = requireCtx(context);
    const limited = rateLimit(ctx, 'setup-version', 20, 60_000);
    if (limited) return limited;
    const connectionId = context.url.searchParams.get('connectionId');
    const repo = context.url.searchParams.get('repo');
    if (!connectionId || !repo) throw new DomainError('validation', 'connectionId and repo');
    return ok({ found: await detectRepoVersion(ctx, connectionId, repo) });
  });
