import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { db, pg } from '../../../db/client';
import { connections, deployments } from '../../../db/schema';
import { verifyWebhookSignature } from '../../../integrations/github/webhook';
import { makeOrg } from '../../ai/__tests__/support';
import { createClient } from '../../portfolio/clients';
import { createProduct } from '../../portfolio/products';
import { handleGithubWebhook } from '../github-webhook';
import { sealVerificationForTest } from '../github-verify';
import { createConnection } from '../service';

afterAll(async () => {
  await pg.end();
});

describe('webhook signature (GitHub test vector)', () => {
  const secret = "It's a Secret to Everybody";
  const sig = 'sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17';
  it('accepts the documented signature and nothing else', () => {
    expect(verifyWebhookSignature('Hello, World!', sig, secret)).toBe(true);
    expect(verifyWebhookSignature('Hello, World?', sig, secret)).toBe(false); // body changed
    expect(verifyWebhookSignature('Hello, World!', sig, 'other')).toBe(false); // wrong secret
    expect(verifyWebhookSignature('Hello, World!', sig.replace('sha256=', ''), secret)).toBe(false); // no prefix
    expect(verifyWebhookSignature('Hello, World!', null, secret)).toBe(false);
    expect(verifyWebhookSignature('Hello, World!', 'sha256=zz', secret)).toBe(false);
    expect(verifyWebhookSignature('Hello, World!', sig, '')).toBe(false);
  });
});

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

async function world(installationId: number) {
  const o = await makeOrg();
  const product = await createProduct(o.ownerCtx, { name: 'Invly' });
  const client = await createClient(o.ownerCtx, { name: 'Butik Kebaya' });
  const conn = await createConnection(o.ownerCtx, { kind: 'github', name: 'GH', installationId, verification: sealVerificationForTest(o.ownerCtx, [{ id: installationId, account: 'asiifdev' }]) });
  const mk = async (env: string, repo: string, branch: string, deployedCommit: string) => {
    const [d] = await db.insert(deployments).values({ orgId: o.ownerCtx.orgId, productId: product.id, clientId: client.id, environment: env, repo, branch, deployedCommit }).returning({ id: deployments.id });
    return d.id;
  };
  const read = async (id: string) => (await db.select().from(deployments).where(eq(deployments.id, id)))[0];
  return { o, conn, mk, read };
}
const push = (installationId: number, over: Record<string, unknown> = {}) => ({ ref: 'refs/heads/demo-main', after: SHA_B, deleted: false, repository: { full_name: 'AsiifDev/inventory-app-cursor' }, installation: { id: installationId }, ...over });

describe('GitHub webhook handling (D-058)', () => {
  it('a push moves the latest commit of this organization\'s deployments of that repo and branch only', async () => {
    const w = await world(9001);
    const hit = await w.mk('production', 'asiifdev/inventory-app-cursor', 'demo-main', SHA_A);
    const sameCommit = await w.mk('staging', 'asiifdev/inventory-app-cursor', 'demo-main', SHA_B);
    const otherBranch = await w.mk('qa', 'asiifdev/inventory-app-cursor', 'main', SHA_A);
    const otherRepo = await w.mk('dev', 'asiifdev/other', 'demo-main', SHA_A);
    expect(await handleGithubWebhook('push', 'd-0001-aaaa', push(9001))).toBe('push');
    expect(await w.read(hit)).toMatchObject({ latestCommit: SHA_B, behindBy: null });
    expect(await w.read(sameCommit)).toMatchObject({ latestCommit: SHA_B, behindBy: 0 }); // already on the tip
    expect((await w.read(otherBranch)).latestCommit).toBeNull();
    expect((await w.read(otherRepo)).latestCommit).toBeNull();
  });

  it('never touches another organization, even for the same repo and branch', async () => {
    const a = await world(9002);
    const b = await world(9003);
    const mine = await a.mk('production', 'asiifdev/app', 'demo-main', SHA_A);
    const theirs = await b.mk('production', 'asiifdev/app', 'demo-main', SHA_A);
    await handleGithubWebhook('push', 'd-0002-aaaa', push(9002, { repository: { full_name: 'asiifdev/app' } }));
    expect((await a.read(mine)).latestCommit).toBe(SHA_B);
    expect((await b.read(theirs)).latestCommit).toBeNull();
  });

  it('acts on a delivery once, and ignores deletes, tags, unknown installations, junk and other events', async () => {
    const w = await world(9004);
    const id = await w.mk('production', 'asiifdev/app', 'demo-main', SHA_A);
    const body = push(9004, { repository: { full_name: 'asiifdev/app' } });
    expect(await handleGithubWebhook('push', 'd-0003-aaaa', body)).toBe('push');
    expect(await handleGithubWebhook('push', 'd-0003-aaaa', body)).toBe('duplicate');
    expect(await handleGithubWebhook('push', 'd-0004-aaaa', push(9004, { deleted: true, repository: { full_name: 'asiifdev/app' } }))).toBe('ignored');
    expect(await handleGithubWebhook('push', 'd-0005-aaaa', push(9004, { ref: 'refs/tags/v1', repository: { full_name: 'asiifdev/app' } }))).toBe('ignored');
    expect(await handleGithubWebhook('push', 'd-0006-aaaa', push(424242))).toBe('unknown_installation');
    expect(await handleGithubWebhook('push', 'd-0007-aaaa', { nonsense: true })).toBe('ignored');
    expect(await handleGithubWebhook('push', 'd-0008-aaaa', push(9004, { after: 'not-a-sha' }))).toBe('ignored');
    expect(await handleGithubWebhook('issues', 'd-0009-aaaa', {})).toBe('ignored');
    expect(await handleGithubWebhook('ping', 'd-0010-aaaa', {})).toBe('ping');
    expect((await w.read(id)).latestCommit).toBe(SHA_B);
  });

  it('a removed or suspended installation marks the connection, and unsuspending resets it', async () => {
    const w = await world(9005);
    const state = async () => (await db.select().from(connections).where(eq(connections.id, w.conn.id)))[0];
    await handleGithubWebhook('installation', 'd-0011-aaaa', { action: 'suspend', installation: { id: 9005 } });
    expect(await state()).toMatchObject({ testStatus: 'failed', testMessage: 'unauthorized' });
    await handleGithubWebhook('installation', 'd-0012-aaaa', { action: 'unsuspend', installation: { id: 9005 } });
    expect(await state()).toMatchObject({ testStatus: 'untested', testMessage: null });
    await handleGithubWebhook('installation', 'd-0013-aaaa', { action: 'deleted', installation: { id: 9005 } });
    expect(await state()).toMatchObject({ testStatus: 'failed', testMessage: 'not_found' });
  });
});
