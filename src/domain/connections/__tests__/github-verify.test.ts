import { afterAll, describe, expect, it } from 'vitest';
import { pg } from '../../../db/client';
import { makeOrg } from '../../ai/__tests__/support';
import { userCtx } from '../../ctx';
import { DomainError } from '../../errors';
import { completeVerification, readVerification, sealVerificationForTest, startVerification } from '../github-verify';
import { autoLinkVerifiedInstallation, createConnection, listConnections } from '../service';

afterAll(async () => {
  await pg.end();
});
const code = async (p: Promise<unknown>) => ((await p.then(() => null, (e: unknown) => e)) as DomainError | null)?.code;
const gh = (name: string, installationId: number, verification: string) => ({ kind: 'github' as const, name, installationId, verification });

describe('GitHub installation ownership (IDOR fix)', () => {
  it('refuses a bare installation id, a forged token and a token that does not list the installation', async () => {
    const o = await makeOrg();
    expect(await code(createConnection(o.ownerCtx, gh('GH', 1, 'x'.repeat(20))))).toBe('forbidden');
    expect(await code(createConnection(o.ownerCtx, gh('GH', 1, sealVerificationForTest(o.ownerCtx, [{ id: 2, account: 'someone' }]))))).toBe('forbidden');
    const real = sealVerificationForTest(o.ownerCtx, [{ id: 1, account: 'me' }]);
    expect(await code(createConnection(o.ownerCtx, gh('GH', 1, real.slice(0, -2) + 'AA')))).toBe('forbidden'); // tampered
  });

  it('refuses a token made for another organization or another person, or one that expired', async () => {
    const a = await makeOrg();
    const b = await makeOrg();
    const forB = sealVerificationForTest(b.ownerCtx, [{ id: 9, account: 'b' }]);
    expect(await code(createConnection(a.ownerCtx, gh('GH', 9, forB)))).toBe('forbidden');
    const otherPerson = userCtx({ orgId: a.ownerCtx.orgId, userId: 'someone-else', role: 'owner' });
    expect(await code(createConnection(a.ownerCtx, gh('GH', 9, sealVerificationForTest(otherPerson, [{ id: 9, account: 'x' }]))))).toBe('forbidden');
    expect(await code(createConnection(a.ownerCtx, gh('GH', 9, sealVerificationForTest(a.ownerCtx, [{ id: 9, account: 'x' }], -1))))).toBe('forbidden');
  });

  it('accepts a token that vouches for the installation', async () => {
    const o = await makeOrg();
    await createConnection(o.ownerCtx, gh('GH', 7, sealVerificationForTest(o.ownerCtx, [{ id: 7, account: 'asiifdev' }])));
  });

  it('round trip: state and cookie must match, then GitHub decides what the person may reach', async () => {
    const o = await makeOrg();
    process.env.GITHUB_APP_CLIENT_ID = 'Iv.test';
    process.env.GITHUB_APP_CLIENT_SECRET = 'secret-test';
    const calls: string[] = [];
    const f = (async (url: string) => {
      calls.push(url);
      if (url.includes('login/oauth/access_token')) return new Response(JSON.stringify({ access_token: 'ghu_x' }), { status: 200 });
      return new Response(JSON.stringify({ total_count: 1, installations: [{ id: 42, account: { login: 'asiifdev' } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const { state, nonce } = startVerification(o.ownerCtx);
    const ok = { code: 'abc', state, nonce, redirectUri: 'https://x.test/api/github/callback' };

    expect(await code(completeVerification(o.ownerCtx, { ...ok, nonce: 'wrong-nonce-value-here-0000000000' }, { fetch: f }))).toBe('forbidden');
    const other = await makeOrg();
    expect(await code(completeVerification(other.ownerCtx, ok, { fetch: f }))).toBe('forbidden'); // state belongs to another organization
    expect(calls).toEqual([]); // nothing reached GitHub before the checks passed

    const token = await completeVerification(o.ownerCtx, ok, { fetch: f });
    expect(readVerification(o.ownerCtx, token)).toEqual([{ id: 42, account: 'asiifdev' }]);
    expect(readVerification(other.ownerCtx, token)).toBeNull();
    await createConnection(o.ownerCtx, gh('GH', 42, token));
  });

  it('links by itself when exactly one installation is vouched for, and leaves several to the owner', async () => {
    const o = await makeOrg();
    expect(await autoLinkVerifiedInstallation(o.ownerCtx, sealVerificationForTest(o.ownerCtx, [{ id: 71, account: 'one' }, { id: 72, account: 'two' }]))).toBe(false);
    expect(await listConnections(o.ownerCtx)).toEqual([]);
    const single = sealVerificationForTest(o.ownerCtx, [{ id: 73, account: 'asiifdev' }]);
    expect(await autoLinkVerifiedInstallation(o.ownerCtx, single)).toBe(true);
    expect((await listConnections(o.ownerCtx)).map((c) => c.name)).toEqual(['GitHub @asiifdev']);
    expect(await autoLinkVerifiedInstallation(o.ownerCtx, single)).toBe(false); // already linked: left alone
    expect(await autoLinkVerifiedInstallation(o.ownerCtx, 'forged-token-forged-token')).toBe(false);
  });

  it('only the owner may start it', async () => {
    const o = await makeOrg();
    expect(() => startVerification(o.adminCtx)).toThrow(DomainError);
  });
});
