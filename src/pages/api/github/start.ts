import type { APIRoute } from 'astro';
import { startVerification } from '../../../domain/connections/github-verify';
import { authorizeUrl, callbackUri } from '../../../integrations/github/oauth';
import { handle, requireCtx } from '../../../lib/api';

export const prerender = false;

const COOKIE = 'gh_verify';

/** `GET /api/github/start`: the owner is sent to GitHub to prove which installations they can reach. */
export const GET: APIRoute = (context) =>
  handle(async () => {
    const { state, nonce } = startVerification(requireCtx(context));
    const redirectUri = callbackUri(context.url);
    context.cookies.set(COOKIE, nonce, { httpOnly: true, sameSite: 'lax', secure: context.url.protocol === 'https:', path: '/api/github', maxAge: 600 });
    return new Response(null, { status: 302, headers: { location: authorizeUrl(redirectUri, state), 'cache-control': 'no-store' } });
  });
