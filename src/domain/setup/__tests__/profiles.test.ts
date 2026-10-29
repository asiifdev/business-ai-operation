import { afterAll, describe, expect, it } from 'vitest';
import { pg } from '../../../db/client';
import type { GithubClient } from '../../../integrations/github/client';
import { makeOrg } from '../../ai/__tests__/support';
import { sealVerificationForTest } from '../../connections/github-verify';
import { createConnection } from '../../connections/service';
import { DomainError } from '../../errors';
import { createProduct } from '../../portfolio/products';
import { getSetupProfile, listConnectionRepos, saveSetupProfile } from '../profiles';
import { createFlow } from '../../flows/service';
import { TEMPLATES } from '../../flows/templates';

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
    expect(empty.defaultPortRange).toEqual({ start: 6000, end: 6999 });
    expect(empty.flows).toEqual([]);
    expect(JSON.stringify(empty.connections)).not.toContain('rahasia');
    const saved = await saveSetupProfile(w.o.ownerCtx, w.product.id, { githubConnectionId: w.gh.id, repo: 'asiifdev/inventory-app-cursor', defaultBranch: 'demo-main', mode: 'shared_branch', folderPattern: '{produk}-{klien}', serverConnectionId: w.ssh.id, rulesNotes: 'Satu branch untuk beberapa klien.' });
    expect(saved).toMatchObject({ repo: 'asiifdev/inventory-app-cursor', defaultBranch: 'demo-main', mode: 'shared_branch', isAiDraft: false });
    expect((await getSetupProfile(w.o.ownerCtx, w.product.id)).profile?.rulesNotes).toBe('Satu branch untuk beberapa klien.');
  });

  it('saving again replaces it: one profile per product', async () => {
    const w = await withConnections();
    await saveSetupProfile(w.o.ownerCtx, w.product.id, { repo: 'a/b' });
    const again = await saveSetupProfile(w.o.ownerCtx, w.product.id, { repo: 'a/c', portRangeStart: 6100, portRangeEnd: 6200 });
    expect(again).toMatchObject({ repo: 'a/c', portRangeStart: 6100, portRangeEnd: 6200 });
    await expect(saveSetupProfile(w.o.ownerCtx, w.product.id, { portRangeStart: 6300, portRangeEnd: 6200 })).rejects.toThrow();
    await expect(saveSetupProfile(w.o.ownerCtx, w.product.id, { portRangeStart: 80, portRangeEnd: 90 })).rejects.toThrow(); // below 1024
  });

  it('picks flows of the right kind from this organization only', async () => {
    const w = await withConnections();
    const setup = TEMPLATES.find((t) => t.kind === 'setup')!;
    const update = TEMPLATES.find((t) => t.kind === 'update')!;
    const sf = await createFlow(w.o.ownerCtx, { name: 'Setup', kind: 'setup', definition: setup.build() });
    const uf = await createFlow(w.o.ownerCtx, { name: 'Update', kind: 'update', definition: update.build() });
    const saved = await saveSetupProfile(w.o.ownerCtx, w.product.id, { setupFlowId: sf.id, updateFlowId: uf.id });
    expect(saved).toMatchObject({ setupFlowId: sf.id, updateFlowId: uf.id });
    expect((await getSetupProfile(w.o.staffCtx, w.product.id)).flows.map((f) => f.name)).toEqual(['Setup', 'Update']);
    expect(await code(saveSetupProfile(w.o.ownerCtx, w.product.id, { setupFlowId: uf.id }))).toBe('validation'); // an update flow cannot be the setup flow
    const other = await withConnections();
    const foreign = await createFlow(other.o.ownerCtx, { name: 'Foreign', kind: 'setup', definition: setup.build() });
    expect(await code(saveSetupProfile(w.o.ownerCtx, w.product.id, { setupFlowId: foreign.id }))).toBe('not_found');
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
