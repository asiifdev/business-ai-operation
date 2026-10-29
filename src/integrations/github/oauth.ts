import { env } from '../../lib/env';
import { GithubError, type Fetch } from './client';

/**
 * GitHub App user authorization (skill `github-app-integration` §7). Used once, to prove that the person linking an
 * installation can actually reach it: the `code` is traded for a user token, the token lists the installations of THIS App
 * the person may access, and the token is thrown away. It is never stored.
 */
export function oauthCredentials(): { clientId: string; clientSecret: string } {
  const clientId = env('GITHUB_APP_CLIENT_ID');
  const clientSecret = env('GITHUB_APP_CLIENT_SECRET');
  if (!clientId || !clientSecret) throw new GithubError('not_configured', 'GitHub App OAuth is not configured on this server');
  return { clientId, clientSecret };
}

/**
 * The address GitHub returns the person to: always the one configured `APP_URL` (D-058: a single production address for the
 * App's callback, setup and webhook URLs). It must be listed as the Callback URL in the GitHub App settings.
 */
export function callbackUri(requestUrl: URL): string {
  return `${env('APP_URL') ?? requestUrl.origin}/api/github/callback`;
}

export function authorizeUrl(redirectUri: string, state: string): string {
  const { clientId } = oauthCredentials();
  const u = new URL('https://github.com/login/oauth/authorize');
  u.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, state }).toString();
  return u.toString();
}

/** Trades the `code` for a user token. The response is read as JSON (Accept header), as GitHub returns form data otherwise. */
export async function exchangeCode(code: string, redirectUri: string, f: Fetch = fetch): Promise<string> {
  const { clientId, clientSecret } = oauthCredentials();
  const res = await f('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', 'user-agent': 'orbyte' },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new GithubError('unavailable', `GitHub answered ${res.status}`);
  const body = (await res.json()) as { access_token?: string; error?: string };
  // A bad or reused code is answered with 200 and an `error`, not with an error status.
  if (!body.access_token) throw new GithubError('unauthorized', 'GitHub did not accept the authorization code');
  return body.access_token;
}

export interface UserInstallation {
  id: number;
  account: string;
}

/** Installations of this App the person has at least read access to (GET /user/installations). */
export async function listUserInstallations(userToken: string, f: Fetch = fetch): Promise<UserInstallation[]> {
  const out: UserInstallation[] = [];
  for (let page = 1; page <= 5; page++) {
    const res = await f(`https://api.github.com/user/installations?per_page=100&page=${page}`, {
      headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${userToken}`, 'x-github-api-version': '2022-11-28', 'user-agent': 'orbyte' },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 401 || res.status === 403) throw new GithubError('unauthorized', 'GitHub refused the user token');
    if (!res.ok) throw new GithubError('unavailable', `GitHub answered ${res.status}`);
    const body = (await res.json()) as { total_count: number; installations: Array<{ id: number; account?: { login?: string; slug?: string } }> };
    out.push(...body.installations.map((i) => ({ id: i.id, account: i.account?.login ?? i.account?.slug ?? '' })));
    if (out.length >= body.total_count || body.installations.length === 0) break;
  }
  return out;
}
