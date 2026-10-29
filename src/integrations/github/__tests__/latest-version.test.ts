import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { githubClient, GithubError } from '../client';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const NOW = new Date('2026-10-29T10:00:00Z');
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status });

function client(routes: Record<string, () => Response>) {
  process.env.GITHUB_APP_ID = '5519645';
  process.env.GITHUB_APP_PRIVATE_KEY = privateKey.replace(/\n/g, '\\n');
  const calls: string[] = [];
  const f = (async (url: string, init: RequestInit = {}) => {
    const key = `${init.method ?? 'GET'} ${url.replace('https://api.github.com', '')}`;
    calls.push(key);
    if (key.startsWith('POST /app/installations/7/access_tokens')) return json({ token: 'ghs_t', expires_at: new Date(NOW.getTime() + 3_600_000).toISOString() });
    const hit = routes[key];
    return hit ? hit() : json({}, 404);
  }) as unknown as typeof fetch;
  return { gh: githubClient(f, () => NOW), calls };
}

describe('GitHub latestVersion (D-065)', () => {
  it('prefers the latest release and drops a leading v', async () => {
    const { gh } = client({ 'GET /repos/acme/app/releases/latest': () => json({ tag_name: 'v2.4.1' }) });
    expect(await gh.latestVersion(7, 'acme/app')).toEqual({ version: '2.4.1', source: 'release' });
  });

  it('falls back to the newest tag when there is no release', async () => {
    const { gh, calls } = client({ 'GET /repos/acme/app/tags?per_page=1': () => json([{ name: 'v1.9.0' }]) });
    expect(await gh.latestVersion(7, 'acme/app')).toEqual({ version: '1.9.0', source: 'tag' });
    expect(calls).toContain('GET /repos/acme/app/releases/latest');
  });

  it('returns null, and guesses nothing, when there is no release, no tag and no branch to read', async () => {
    const { gh } = client({ 'GET /repos/acme/app/tags?per_page=1': () => json([]) });
    expect(await gh.latestVersion(7, 'acme/app')).toBeNull();
  });

  it('for a repository that never publishes versions, uses the short id of the default branch tip', async () => {
    const sha = 'abcdef1234567890'.repeat(2) + 'abcdef12';
    const { gh, calls } = client({ 'GET /repos/acme/app/tags?per_page=1': () => json([]), 'GET /repos/acme/app/branches/main': () => json({ commit: { sha } }) });
    expect(await gh.latestVersion(7, 'acme/app', 'main')).toEqual({ version: 'abcdef1', source: 'commit' });
    expect(calls).toContain('GET /repos/acme/app/releases/latest');
  });

  it('still prefers a tag over the commit when a branch is given', async () => {
    const { gh } = client({ 'GET /repos/acme/app/tags?per_page=1': () => json([{ name: 'v3.0.0' }]) });
    expect(await gh.latestVersion(7, 'acme/app', 'main')).toEqual({ version: '3.0.0', source: 'tag' });
  });

  it('keeps a tag that is not a number as written, only trimming a v before a digit', async () => {
    const { gh } = client({ 'GET /repos/acme/app/tags?per_page=1': () => json([{ name: 'vnext' }]) });
    expect((await gh.latestVersion(7, 'acme/app'))?.version).toBe('vnext');
  });

  it('does not treat a real failure on the release lookup as "no release"', async () => {
    const { gh } = client({ 'GET /repos/acme/app/releases/latest': () => json({}, 503) });
    await expect(gh.latestVersion(7, 'acme/app')).rejects.toBeInstanceOf(GithubError);
  });

  it('refuses a repo name that could change the request path', async () => {
    const { gh } = client({});
    await expect(gh.latestVersion(7, '../../orgs/x')).rejects.toBeInstanceOf(GithubError);
  });
});
