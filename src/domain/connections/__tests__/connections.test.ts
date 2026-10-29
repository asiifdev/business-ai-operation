import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { db, pg } from '../../../db/client';
import { auditLog, connections, deployments } from '../../../db/schema';
import { SshError } from '../../../integrations/ssh/client';
import { makeOrg } from '../../ai/__tests__/support';
import { DomainError } from '../../errors';
import { createClient } from '../../portfolio/clients';
import { createProduct } from '../../portfolio/products';
import { sealVerificationForTest } from '../github-verify';
import { createConnection, deleteConnection, getConnection, listConnections, testConnection, updateConnection, type ConnectionDeps } from '../service';
import { decryptSecret } from '../vault';

afterAll(async () => {
  await pg.end();
});
const rejects = async (p: Promise<unknown>, code: string) => {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err, `expected DomainError ${code}`).toBeInstanceOf(DomainError);
  expect((err as DomainError).code).toBe(code);
};

const ssh = { kind: 'ssh' as const, name: 'Server Demo', host: '8.8.8.8', username: 'deploy', authMethod: 'password' as const, password: 'rahasia-banget-123' };
const FP = 'SHA256:abcDEF123';
function deps(over: Partial<ConnectionDeps> = {}): ConnectionDeps {
  return {
    github: { getInstallation: async () => ({ account: 'asiifdev', repositorySelection: 'selected' }) } as unknown as ConnectionDeps['github'],
    ssh: async (_c, _s, pinned) => (pinned === null ? { fingerprint: FP } : { fingerprint: pinned, close() {}, exec: async () => ({ code: 0, stdout: '', stderr: '', truncated: false }) }),
    aapanelPing: async () => 'ok',
    ...over,
  };
}

describe('M17 connections', () => {
  it('encrypts the secret in the database and never returns it', async () => {
    const o = await makeOrg();
    const { id } = await createConnection(o.ownerCtx, ssh);
    const [row] = await db.select().from(connections).where(eq(connections.id, id));
    expect(row.secretCiphertext).not.toContain('rahasia');
    expect(JSON.stringify(row.config)).not.toContain('rahasia');
    expect(decryptSecret(row.secretCiphertext!, o.ownerCtx.orgId, id)).toEqual({ password: 'rahasia-banget-123' });
    const shown = JSON.stringify([await getConnection(o.ownerCtx, id), await listConnections(o.ownerCtx)]);
    expect(shown).not.toContain('rahasia-banget');
    expect(shown).not.toContain(row.secretCiphertext!);
    expect(shown).toContain('••••-123'); // only the last four characters
    const audit = JSON.stringify(await db.select().from(auditLog).where(eq(auditLog.orgId, o.ownerCtx.orgId)));
    expect(audit).not.toContain('rahasia-banget');
  });

  it('only the owner writes or tests; everyone may read the list without secrets', async () => {
    const o = await makeOrg();
    await rejects(createConnection(o.adminCtx, ssh), 'forbidden');
    const { id } = await createConnection(o.ownerCtx, ssh);
    await rejects(testConnection(o.adminCtx, id, {}, deps()), 'forbidden');
    await rejects(deleteConnection(o.staffCtx, id), 'forbidden');
    expect((await listConnections(o.staffCtx)).map((c) => c.name)).toEqual(['Server Demo']);
  });

  it('is isolated per organization, and names are unique within one', async () => {
    const a = await makeOrg();
    const b = await makeOrg();
    const { id } = await createConnection(a.ownerCtx, ssh);
    await rejects(getConnection(b.ownerCtx, id), 'not_found');
    await rejects(testConnection(b.ownerCtx, id, {}, deps()), 'not_found');
    expect(await listConnections(b.ownerCtx)).toEqual([]);
    await rejects(createConnection(a.ownerCtx, { ...ssh, name: 'server demo' }), 'duplicate');
    await createConnection(b.ownerCtx, ssh); // the same name is fine in another organization
  });

  it('refuses private addresses, a key that is not a key, and a login method without its secret', async () => {
    const o = await makeOrg();
    await rejects(createConnection(o.ownerCtx, { ...ssh, host: '169.254.169.254' }), 'validation');
    await expect(createConnection(o.ownerCtx, { ...ssh, authMethod: 'private_key', password: undefined, privateKey: 'hello' })).rejects.toThrow();
    await expect(createConnection(o.ownerCtx, { ...ssh, authMethod: 'key_and_password', password: undefined, privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----\nx\n-----END OPENSSH PRIVATE KEY-----' })).rejects.toThrow();
    await expect(createConnection(o.ownerCtx, { ...ssh, host: 'a b;rm -rf /' })).rejects.toThrow();
    await rejects(createConnection(o.ownerCtx, { kind: 'aapanel', name: 'Panel', url: 'http://127.0.0.1:7800', apiKey: 'abcdefgh12' }), 'validation');
  });

  it('SSH: the first test reads the fingerprint and sends no credential; confirming pins it', async () => {
    const o = await makeOrg();
    const { id } = await createConnection(o.ownerCtx, ssh);
    const sent: Array<{ password?: string }> = [];
    const d = deps({ ssh: async (_c, secret, pinned) => { sent.push(secret); return pinned === null ? { fingerprint: FP } : { fingerprint: pinned, close() {}, exec: async () => ({ code: 0, stdout: '', stderr: '', truncated: false }) }; } });
    expect(await testConnection(o.ownerCtx, id, {}, d)).toEqual({ status: 'needs_host_key', fingerprint: FP });
    expect(sent).toEqual([{}]); // no password went out
    expect((await getConnection(o.ownerCtx, id)).hostKeyFingerprint).toBeNull();
    expect(await testConnection(o.ownerCtx, id, { acceptHostKey: 'SHA256:somethingElse' }, d)).toMatchObject({ status: 'needs_host_key' });
    expect(await testConnection(o.ownerCtx, id, { acceptHostKey: FP }, d)).toMatchObject({ status: 'ok' });
    expect(await getConnection(o.ownerCtx, id)).toMatchObject({ hostKeyFingerprint: FP, testStatus: 'ok' });
  });

  it('SSH: a changed host key fails the test; moving the connection forgets the pin and the result', async () => {
    const o = await makeOrg();
    const { id } = await createConnection(o.ownerCtx, ssh);
    await testConnection(o.ownerCtx, id, { acceptHostKey: FP }, deps());
    const bad = deps({ ssh: async (_c, _s, pinned) => { if (pinned) throw new SshError('host_key_mismatch'); return { fingerprint: 'SHA256:other' }; } });
    expect(await testConnection(o.ownerCtx, id, {}, bad)).toEqual({ status: 'failed', message: 'host_key_mismatch' });
    expect((await getConnection(o.ownerCtx, id)).testStatus).toBe('failed');
    await updateConnection(o.ownerCtx, id, { host: '1.1.1.1' });
    expect(await getConnection(o.ownerCtx, id)).toMatchObject({ hostKeyFingerprint: null, testStatus: 'untested' });
  });

  it('a failed test explains the kind, never the secret', async () => {
    const o = await makeOrg();
    const { id } = await createConnection(o.ownerCtx, ssh);
    const d = deps({ ssh: async (_c, _s, pinned) => { if (pinned) throw new SshError('auth_failed'); return { fingerprint: FP }; } });
    const r = await testConnection(o.ownerCtx, id, { acceptHostKey: FP }, d);
    expect(r).toEqual({ status: 'failed', message: 'auth_failed' });
    expect(JSON.stringify(await getConnection(o.ownerCtx, id))).not.toContain('rahasia-banget');
  });

  it('GitHub: records the installation account; aaPanel: reports a rejected key', async () => {
    const o = await makeOrg();
    const gh = await createConnection(o.ownerCtx, { kind: 'github', name: 'GitHub Asiifdev', installationId: 123, verification: sealVerificationForTest(o.ownerCtx, [{ id: 123, account: 'asiifdev' }]) });
    expect(await testConnection(o.ownerCtx, gh.id, {}, deps())).toEqual({ status: 'ok', message: 'asiifdev' });
    expect((await getConnection(o.ownerCtx, gh.id)).config).toMatchObject({ installationId: 123, account: 'asiifdev' });
    const ap = await createConnection(o.ownerCtx, { kind: 'aapanel', name: 'aaPanel Utama', url: 'https://8.8.4.4:7800/login?x=1', apiKey: 'kunci-api-panel-1' });
    expect((await getConnection(o.ownerCtx, ap.id)).config).toEqual({ url: 'https://8.8.4.4:7800', tlsInsecure: false });
    const { AapanelError } = await import('../../../integrations/aapanel/client');
    expect(await testConnection(o.ownerCtx, ap.id, {}, deps({ aapanelPing: async () => { throw new AapanelError('rejected'); } }))).toEqual({ status: 'failed', message: 'rejected' });
  });

  it('a GitHub installation can be linked by one organization only', async () => {
    const a = await makeOrg();
    const b = await makeOrg();
    await createConnection(a.ownerCtx, { kind: 'github', name: 'GitHub A', installationId: 555, verification: sealVerificationForTest(a.ownerCtx, [{ id: 555, account: 'a' }]) });
    await rejects(createConnection(b.ownerCtx, { kind: 'github', name: 'GitHub B', installationId: 555, verification: sealVerificationForTest(b.ownerCtx, [{ id: 555, account: 'a' }]) }), 'duplicate');
  });

  it('cannot delete a connection that is in use, can delete a free one (BR-M17-13)', async () => {
    const o = await makeOrg();
    const { id } = await createConnection(o.ownerCtx, ssh);
    const product = await createProduct(o.ownerCtx, { name: 'Invly' });
    const client = await createClient(o.ownerCtx, { name: 'Butik Kebaya' });
    const [dep] = await db.insert(deployments).values({ orgId: o.ownerCtx.orgId, productId: product.id, clientId: client.id, environment: 'production', serverConnectionId: id }).returning({ id: deployments.id });
    await rejects(deleteConnection(o.ownerCtx, id), 'invalid_state');
    await db.update(deployments).set({ serverConnectionId: null }).where(and(eq(deployments.orgId, o.ownerCtx.orgId), eq(deployments.id, dep.id)));
    await deleteConnection(o.ownerCtx, id);
    expect(await listConnections(o.ownerCtx)).toEqual([]);
  });
});
