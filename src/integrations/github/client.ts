import { createSign } from 'node:crypto';
import { env } from '../../lib/env';

/**
 * GitHub App client (skill `github-app-integration`). The platform's App signs a short JWT; the JWT is traded for an
 * installation token that lasts an hour and lives in memory only. Nothing here is a per-organization secret: an
 * organization is identified by its `installationId` (BR-M17-01, -02).
 */
const API = 'https://api.github.com';
/** ⚠️ Pinned to one stable API version; the docs show the newest one. */
const API_VERSION = '2022-11-28';

export type Fetch = typeof fetch;

const b64url = (input: Buffer | string) => Buffer.from(input).toString('base64url');

export function appCredentials(): { appId: string; privateKey: string } {
  const appId = env('GITHUB_APP_ID');
  const key = env('GITHUB_APP_PRIVATE_KEY');
  if (!appId || !key) throw new GithubError('not_configured', 'GitHub App is not configured on this server');
  // A key kept on one line in .env has literal "\n" in place of line breaks.
  return { appId, privateKey: key.includes('\\n') ? key.replace(/\\n/g, '\n') : key };
}

/** RS256, `iat` 60 s in the past (clock drift), `exp` within 10 minutes (GitHub's limit). `iss` is the App id. */
export function createAppJwt(appId: string, privateKey: string, now: Date = new Date()): string {
  const iat = Math.floor(now.getTime() / 1000) - 60;
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ iat, exp: iat + 9 * 60 + 60, iss: appId }));
  const sig = createSign('RSA-SHA256').update(`${head}.${body}`).sign(privateKey);
  return `${head}.${body}.${b64url(sig)}`;
}

export class GithubError extends Error {
  constructor(
    public readonly kind: 'not_configured' | 'unauthorized' | 'not_found' | 'rate_limited' | 'unavailable',
    message: string,
    public readonly retryAfterSec?: number,
  ) {
    super(message);
    this.name = 'GithubError';
  }
}

async function call(f: Fetch, method: string, path: string, token: string, body?: unknown): Promise<unknown> {
  const res = await f(`${API}${path}`, {
    method,
    headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${token}`, 'x-github-api-version': API_VERSION, 'user-agent': 'orbyte', ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  if (res.ok) return res.status === 204 ? null : res.json();
  // 403/429 with a retry hint or an exhausted window is a rate limit; any other 403 is a permission problem.
  const retry = Number(res.headers.get('retry-after'));
  const exhausted = res.headers.get('x-ratelimit-remaining') === '0';
  if (res.status === 429 || (res.status === 403 && (retry > 0 || exhausted))) {
    const reset = Number(res.headers.get('x-ratelimit-reset'));
    throw new GithubError('rate_limited', 'GitHub rate limit', retry > 0 ? retry : exhausted && reset ? Math.max(reset - Math.floor(Date.now() / 1000), 60) : 60);
  }
  if (res.status === 401 || res.status === 403) throw new GithubError('unauthorized', `GitHub refused (${res.status})`);
  if (res.status === 404) throw new GithubError('not_found', 'not found on GitHub');
  throw new GithubError('unavailable', `GitHub answered ${res.status}`);
}

export interface GithubClient {
  /** The installation exists and belongs to this App; returns the account it is installed on. */
  getInstallation(installationId: number): Promise<{ account: string; repositorySelection: string }>;
  listRepositories(installationId: number): Promise<Array<{ fullName: string; defaultBranch: string }>>;
  /** The commit at the tip of a branch. */
  getBranchHead(installationId: number, repo: string, branch: string): Promise<string>;
  /** How many commits `head` is ahead of `base` (the deployed commit). 0 means the server has the latest. */
  commitsAhead(installationId: number, repo: string, base: string, head: string): Promise<number>;
  /**
   * The newest version of a repository (D-065): its latest release, else its newest tag, else (when a branch is given)
   * the short id of the commit at the tip of that branch, for repositories that never publish versions. Returns null when
   * none applies. The leading `v` of a release or tag is dropped; nothing else is guessed.
   */
  latestVersion(installationId: number, repo: string, branch?: string | null): Promise<{ version: string; source: 'release' | 'tag' | 'commit' } | null>;
  /** A token for git over HTTPS, kept only for the step that needs it. */
  installationToken(installationId: number): Promise<string>;
}

const REPO = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const SHA = /^[0-9a-f]{7,64}$/;

export function githubClient(f: Fetch = fetch, now: () => Date = () => new Date()): GithubClient {
  const tokens = new Map<number, { token: string; expiresAt: number }>();
  const jwt = () => {
    const { appId, privateKey } = appCredentials();
    return createAppJwt(appId, privateKey, now());
  };
  async function token(installationId: number): Promise<string> {
    const cached = tokens.get(installationId);
    if (cached && cached.expiresAt - now().getTime() > 5 * 60_000) return cached.token;
    const res = (await call(f, 'POST', `/app/installations/${installationId}/access_tokens`, jwt(), {})) as { token: string; expires_at: string };
    tokens.set(installationId, { token: res.token, expiresAt: new Date(res.expires_at).getTime() });
    return res.token;
  }
  return {
    async getInstallation(installationId) {
      const r = (await call(f, 'GET', `/app/installations/${installationId}`, jwt())) as { account?: { login?: string }; repository_selection?: string };
      return { account: r.account?.login ?? '', repositorySelection: r.repository_selection ?? '' };
    },
    async listRepositories(installationId) {
      const out: Array<{ fullName: string; defaultBranch: string }> = [];
      for (let page = 1; page <= 10; page++) {
        const r = (await call(f, 'GET', `/installation/repositories?per_page=100&page=${page}`, await token(installationId))) as { total_count: number; repositories: Array<{ full_name: string; default_branch: string }> };
        out.push(...r.repositories.map((x) => ({ fullName: x.full_name, defaultBranch: x.default_branch })));
        if (out.length >= r.total_count || r.repositories.length === 0) break;
      }
      return out;
    },
    async getBranchHead(installationId, repo, branch) {
      if (!REPO.test(repo) || !/^[A-Za-z0-9._/-]{1,200}$/.test(branch) || branch.startsWith('-') || branch.includes('..')) throw new GithubError('not_found', 'invalid repo or branch');
      const r = (await call(f, 'GET', `/repos/${repo}/branches/${encodeURIComponent(branch).replace(/%2F/g, '/')}`, await token(installationId))) as { commit: { sha: string } };
      return r.commit.sha;
    },
    async commitsAhead(installationId, repo, base, head) {
      if (!REPO.test(repo) || !SHA.test(base) || !SHA.test(head)) throw new GithubError('not_found', 'invalid repo or commit');
      if (base === head) return 0;
      const r = (await call(f, 'GET', `/repos/${repo}/compare/${base}...${head}`, await token(installationId))) as { ahead_by: number };
      return r.ahead_by;
    },
    async latestVersion(installationId, repo, branch) {
      if (!REPO.test(repo)) throw new GithubError('not_found', 'invalid repo');
      const clean = (name: string) => name.trim().replace(/^v(?=\d)/i, '');
      const t = await token(installationId);
      try {
        const release = (await call(f, 'GET', `/repos/${repo}/releases/latest`, t)) as { tag_name?: string };
        if (release.tag_name) return { version: clean(release.tag_name), source: 'release' };
      } catch (e) {
        if (!(e instanceof GithubError) || e.kind !== 'not_found') throw e; // no release yet is normal; anything else is a real failure
      }
      const tags = (await call(f, 'GET', `/repos/${repo}/tags?per_page=1`, t)) as Array<{ name: string }>;
      if (tags[0]?.name) return { version: clean(tags[0].name), source: 'tag' };
      if (!branch) return null;
      const head = (await this.getBranchHead(installationId, repo, branch)).slice(0, 7);
      return { version: head, source: 'commit' };
    },
    installationToken: token,
  };
}
