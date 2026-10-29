import type { APIRoute } from 'astro';
import { completeVerification } from '../../../domain/connections/github-verify';
import { autoLinkVerifiedInstallation } from '../../../domain/connections/service';
import { DomainError } from '../../../domain/errors';
import { callbackUri } from '../../../integrations/github/oauth';
import { env } from '../../../lib/env';
import { readVerification } from '../../../domain/connections/github-verify';
import { requireCtx } from '../../../lib/api';

export const prerender = false;

const back = (token?: string, error?: string) =>
  new Response(null, { status: 302, headers: { location: `/app/koneksi?${token ? `gh=${encodeURIComponent(token)}` : `gh_error=${error ?? 'failed'}`}`, 'cache-control': 'no-store' } });

/** `GET /api/github/callback`: GitHub returns here with `code` and `state`. Never shows the code or the token. */
export const GET: APIRoute = async (context) => {
  const q = context.url.searchParams;
  const code = q.get('code');
  const state = q.get('state');
  const nonce = context.cookies.get('gh_verify')?.value;
  context.cookies.delete('gh_verify', { path: '/api/github' });
  if (!code || !state || !nonce) return back(undefined, 'cancelled'); // for example the person declined on GitHub
  try {
    const ctx = requireCtx(context);
    const token = await completeVerification(ctx, { code, state, nonce, redirectUri: callbackUri(context.url) });
    // One installation: connect it straight away. Several: the page lets the owner choose.
    if (await autoLinkVerifiedInstallation(ctx, token)) {
      context.cookies.delete('gh_installing', { path: '/' });
      return new Response(null, { status: 302, headers: { location: '/app/koneksi?gh_linked=1', 'cache-control': 'no-store' } });
    }
    if ((readVerification(ctx, token) ?? []).length === 0) {
      // The App is not installed yet: send the person to install it (once; GitHub returns them to the Setup URL afterwards).
      const slug = env('GITHUB_APP_SLUG');
      if (slug && !context.cookies.get('gh_installing')) {
        context.cookies.set('gh_installing', '1', { httpOnly: true, sameSite: 'lax', secure: context.url.protocol === 'https:', path: '/', maxAge: 600 });
        return new Response(null, { status: 302, headers: { location: `https://github.com/apps/${slug}/installations/new`, 'cache-control': 'no-store' } });
      }
      return back(undefined, 'none');
    }
    return back(token);
  } catch (error) {
    if (error instanceof DomainError) return back(undefined, error.code);
    console.error('github callback', error instanceof Error ? error.name : 'error'); // the message could echo a token: log the kind only
    return back(undefined, 'failed');
  }
};
