import type { APIRoute } from 'astro';
import { suggestProfileFromSite } from '../../../../domain/org/profile-autofill';
import { handle, ok, rateLimit, readJson, requireCtx } from '../../../../lib/api';

export const prerender = false;

/**
 * `POST /api/settings/company/autofill` `{ url }`: reads the website (the page given plus its about, services and contact
 * pages) and answers with a SUGGESTION for the profile. Nothing is saved. Owner and Admin; a few per ten minutes.
 */
export const POST: APIRoute = (context) =>
  handle(async () => {
    const ctx = requireCtx(context);
    const limited = rateLimit(ctx, 'profile-autofill', 5, 10 * 60_000);
    if (limited) return limited;
    return ok(await suggestProfileFromSite(ctx, await readJson(context.request), { locale: context.locals.locale }));
  });
