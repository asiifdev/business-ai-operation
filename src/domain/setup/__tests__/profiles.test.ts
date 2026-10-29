import { afterAll, describe, expect, it } from 'vitest';
import { pg } from '../../../db/client';
import type { GithubClient } from '../../../integrations/github/client';
import { makeOrg } from '../../ai/__tests__/support';
import { sealVerificationForTest } from '../../connections/github-verify';
import { createConnection } from '../../connections/service';
import { DomainError } from '../../errors';
import { createProduct } from '../../portfolio/products';
import { getSetupProfile, listConnectionRepos, saveSetupProfile } from '../profiles';
import { DEFAULT_SETUP_STEPS } from '../steps';

afterAll(async () => {
  await pg.end();
});
const code = async (p: Promise<unknown>) => ((await p.then(() => null, (e: unknown) => e)) as DomainError | null)?.code;

async function withConnections() {
  const o = await makeOrg();
  const product = await createProduct(o.ownerCtx, { name: 'Invly' });
  const id = Math.floor(Math.random() * 1e9) + 1;
  const gh = await createConnection(o.ownerCtx, { kind: 'github', installationId: id, verification: sealVerificationForTest(o.ownerCtx, [{ id, account: 'asiifdev' }]) });
  const ssh = await createConnection(o.ownerCtx, { kind: 'ssh', name: 'Server', host: '8.8.8.8', username: 'deploy', authMethod: 'password', password: 'rahasia-banget-123' });
  return { o, product, gh, ssh };
}

describe('M17 product setup profile', () => {
  it('has no profile until one is saved, then returns it with the choices and no secret', async () => {
    const w = await withConnections();
    const empty = await getSetupProfile(w.o.ownerCtx, w.product.id);
    expect(empty.profile).toBeNull();
    expect(empty.defaultSteps).toEqual(DEFAULT_SETUP_STEPS);
    expect(JSON.stringify(empty.connections)).not.toContain('rahasia');
    const saved = await saveSetupProfile(w.o.ownerCtx, w.product.id, { githubConnectionId: w.gh.id, repo: 'asiifdev/inventory-app-cursor', defaultBranch: 'demo-main', mode: 'shared_branch', folderPattern: '{produk}-{klien}', serverConnectionId: w.ssh.id, rulesNotes: 'Satu branch untuk beberapa klien.' });
    expect(saved).toMatchObject({ repo: 'asiifdev/inventory-app-cursor', defaultBranch: 'demo-main', mode: 'shared_branch', isAiDraft: false });
    expect(saved.steps).toEqual(DEFAULT_SETUP_STEPS);
    expect((await getSetupProfile(w.o.ownerCtx, w.product.id)).profile?.rulesNotes).toBe('Satu branch untuk beberapa klien.');
  });

  it('saving again replaces it (one profile per product), and keeps the chosen steps in the catalogue', async () => {
    const w = await withConnections();
    await saveSetupProfile(w.o.ownerCtx, w.product.id, { repo: 'a/b' });
    const again = await saveSetupProfile(w.o.ownerCtx, w.product.id, { repo: 'a/c', steps: [{ key: 'git_clone' }, { key: 'git_clone' }, { key: 'verify_http' }] });
    expect(again.repo).toBe('a/c');
    expect(again.steps).toEqual(['git_clone', 'verify_http']);
    await expect(saveSetupProfile(w.o.ownerCtx, w.product.id, { steps: [{ key: 'rm_rf' as never }] })).rejects.toThrow();
  });

  it.each([
    ['repo with path tricks', { repo: 'a/../b' }],
    ['repo without owner', { repo: 'justname' }],
    ['branch that is an option', { defaultBranch: '--upload-pack=x' }],
    ['branch that climbs', { defaultBranch: 'a/../b' }],
    ['folder with a slash', { folderPattern: 'a/b' }],
    ['folder with an unknown placeholder', { folderPattern: '{secret}' }],
    ['folder with a shell character', { folderPattern: 'x;rm' }],
  ])('refuses %s', async (_n, bad) => {
    const w = await withConnections();
    await expect(saveSetupProfile(w.o.ownerCtx, w.product.id, bad as never)).rejects.toThrow();
  });

  it('only accepts this organization\'s connections, of the right kind', async () => {
    const w = await withConnections();
    const other = await withConnections();
    expect(await code(saveSetupProfile(w.o.ownerCtx, w.product.id, { githubConnectionId: other.gh.id }))).toBe('not_found');
    expect(await code(saveSetupProfile(w.o.ownerCtx, w.product.id, { githubConnectionId: w.ssh.id }))).toBe('validation');
    expect(await code(saveSetupProfile(w.o.ownerCtx, w.product.id, { serverConnectionId: w.gh.id }))).toBe('validation');
    expect(await code(saveSetupProfile(other.o.ownerCtx, w.product.id, { repo: 'a/b' }))).toBe('not_found'); // another organization's product
    expect(await code(getSetupProfile(other.o.ownerCtx, w.product.id))).toBe('not_found');
  });

  it('staff read but do not write; an assistant\'s proposal stays flagged until a person saves it', async () => {
    const w = await withConnections();
    expect(await code(saveSetupProfile(w.o.staffCtx, w.product.id, { repo: 'a/b' }))).toBe('forbidden');
    await saveSetupProfile({ ...w.o.adminCtx, actor: 'ai:run-1' }, w.product.id, { repo: 'a/b' });
    expect((await getSetupProfile(w.o.staffCtx, w.product.id)).profile?.isAiDraft).toBe(true);
    expect((await saveSetupProfile(w.o.adminCtx, w.product.id, { repo: 'a/b' })).isAiDraft).toBe(false);
  });

  it('lists the repositories of a GitHub connection, and only of a GitHub connection', async () => {
    const w = await withConnections();
    const fake = { listRepositories: async () => [{ fullName: 'asiifdev/inventory-app-cursor', defaultBranch: 'main' }] } as unknown as GithubClient;
    expect(await listConnectionRepos(w.o.ownerCtx, w.gh.id, fake)).toEqual([{ fullName: 'asiifdev/inventory-app-cursor', defaultBranch: 'main' }]);
    expect(await code(listConnectionRepos(w.o.ownerCtx, w.ssh.id, fake))).toBe('not_found');
  });
});
