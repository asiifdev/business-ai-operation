import { createPublicKey, createVerify, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createAppJwt, githubClient, GithubError } from '../client';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const NOW = new Date('2026-10-29T10:00:00Z');

describe('GitHub App JWT', () => {
  it('is RS256, backdated 60 s, and expires within 10 minutes (GitHub rule)', () => {
    const [h, b, s] = createAppJwt('5519645', privateKey, NOW).split('.');
    expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toEqual({ alg: 'RS256', typ: 'JWT' });
    const claims = JSON.parse(Buffer.from(b, 'base64url').toString()) as { iat: number; exp: number; iss: string };
    const now = Math.floor(NOW.getTime() / 1000);
    expect(claims.iss).toBe('5519645');
    expect(claims.iat).toBe(now - 60);
    expect(claims.exp - now).toBeLessThanOrEqual(600);
    expect(createVerify('RSA-SHA256').update(`${h}.${b}`).verify(createPublicKey(publicKey), Buffer.from(s, 'base64url'))).toBe(true);
  });
});

function fakeFetch(routes: Record<string, (init: RequestInit) => Response>) {
  const calls: Array<{ method: string; url: string; auth: string | null }> = [];
  const f = (async (url: string, init: RequestInit = {}) => {
    const path = url.replace('https://api.github.com', '');
    calls.push({ method: init.method ?? 'GET', url: path, auth: new Headers(init.headers).get('authorization') });
    const route = Object.entries(routes).find(([k]) => `${init.method ?? 'GET'} ${path}` === k || (k.endsWith('*') && `${init.method ?? 'GET'} ${path}`.startsWith(k.slice(0, -1))));
    return route ? route[1](init) : new Response('{}', { status: 404 });
  }) as unknown as typeof fetch;
  return { f, calls };
}
const json = (o: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(o), { status: 200, ...init });

describe('GitHub client', () => {
  process.env.GITHUB_APP_ID = '5519645';
  process.env.GITHUB_APP_PRIVATE_KEY = privateKey.replace(/\n/g, '\\n');

  it('trades the JWT for an installation token once, then reuses it', async () => {
    const { f, calls } = fakeFetch({
      'POST /app/installations/7/access_tokens': () => json({ token: 'ghs_test', expires_at: new Date(NOW.getTime() + 3_600_000).toISOString() }),
      'GET /repos/acme/app/branches/demo-main': () => json({ commit: { sha: 'a'.repeat(40) } }),
    });
    const gh = githubClient(f, () => NOW);
    expect(await gh.getBranchHead(7, 'acme/app', 'demo-main')).toBe('a'.repeat(40));
    await gh.getBranchHead(7, 'acme/app', 'demo-main');
    expect(calls.filter((c) => c.url.includes('access_tokens'))).toHaveLength(1);
    expect(calls.find((c) => c.url.includes('branches'))?.auth).toBe('Bearer ghs_test');
    expect(calls[0].auth).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/); // the JWT, only for the token request
  });

  it('refuses a repo, branch or commit that could smuggle something into a path', async () => {
    const gh = githubClient(fakeFetch({}).f, () => NOW);
    await expect(gh.getBranchHead(7, 'acme/app', '--upload-pack=x')).rejects.toMatchObject({ kind: 'not_found' });
    await expect(gh.getBranchHead(7, 'acme/app', 'a/../b')).rejects.toBeInstanceOf(GithubError);
    await expect(gh.getBranchHead(7, 'acme/app/../../x', 'main')).rejects.toBeInstanceOf(GithubError);
    await expect(gh.commitsAhead(7, 'acme/app', 'abc1234', 'not-a-sha')).rejects.toBeInstanceOf(GithubError);
  });

  it('counts commits ahead, and says 0 without a request when the commits are the same', async () => {
    const { f, calls } = fakeFetch({
      'POST /app/installations/7/access_tokens': () => json({ token: 't', expires_at: new Date(NOW.getTime() + 3_600_000).toISOString() }),
      'GET /repos/acme/app/compare/*': () => json({ ahead_by: 3 }),
    });
    const gh = githubClient(f, () => NOW);
    expect(await gh.commitsAhead(7, 'acme/app', 'abc1234', 'def5678')).toBe(3);
    const before = calls.length;
    expect(await gh.commitsAhead(7, 'acme/app', 'abc1234', 'abc1234')).toBe(0);
    expect(calls.length).toBe(before);
  });

  it('tells a rate limit (with when to retry) from a permission problem', async () => {
    const limited = githubClient(fakeFetch({ 'GET /app/installations/7': () => new Response('{}', { status: 403, headers: { 'retry-after': '30' } }) }).f, () => NOW);
    await expect(limited.getInstallation(7)).rejects.toMatchObject({ kind: 'rate_limited', retryAfterSec: 30 });
    const denied = githubClient(fakeFetch({ 'GET /app/installations/7': () => new Response('{}', { status: 403 }) }).f, () => NOW);
    await expect(denied.getInstallation(7)).rejects.toMatchObject({ kind: 'unauthorized' });
  });

  it('never puts the private key in an error', async () => {
    process.env.GITHUB_APP_PRIVATE_KEY = 'not a key';
    const gh = githubClient(fakeFetch({}).f, () => NOW);
    const err = await gh.getInstallation(7).catch((e: Error) => e);
    expect(String((err as Error).message)).not.toContain('not a key');
    process.env.GITHUB_APP_PRIVATE_KEY = privateKey.replace(/\n/g, '\\n');
  });
});
