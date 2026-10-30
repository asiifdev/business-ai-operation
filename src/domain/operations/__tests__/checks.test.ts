import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { db, pg } from '../../../db/client';
import { deployments, findings } from '../../../db/schema';
import type { GithubClient } from '../../../integrations/github/client';
import { sweepActionCenter } from '../../action-center/rules';
import { makeOrg } from '../../ai/__tests__/support';
import { createConnection } from '../../connections/service';
import { sealVerificationForTest } from '../../connections/github-verify';
import { createClient } from '../../portfolio/clients';
import { createDeployment } from '../../portfolio/deployments';
import { createProduct } from '../../portfolio/products';
import { checkCodeDrift, checkUptime, emitDeploymentFindings, runOperationChecks } from '../checks';

afterAll(async () => {
  await pg.end();
});

async function world(domain = 'crm.aksara.co.id') {
  const o = await makeOrg('2026-10-28T03:00:00Z');
  const product = await createProduct(o.ownerCtx, { name: 'Orbit CRM' });
  const client = await createClient(o.ownerCtx, { name: 'Aksara Studio' });
  const { id } = await createDeployment(o.ownerCtx, { productId: product.id, clientId: client.id, environment: 'production', domain });
  return { o, id };
}

const rowsOf = (orgId: string, rule: 'deployment_down' | 'deployment_outdated') => db.select().from(findings).where(and(eq(findings.orgId, orgId), eq(findings.rule, rule)));
const minutes = (iso: string, n: number) => new Date(new Date(iso).getTime() + n * 60_000);

describe('uptime check (PRD M17)', () => {
  it('raises deployment_down after two failed checks, once per spell, and closes it when the site answers', async () => {
    const { o, id } = await world();
    const t0 = '2026-10-28T03:00:00Z';
    await checkUptime(o.orgId, new Date(t0), async () => false);
    expect((await emitDeploymentFindings(o.orgId)).down).toBe(0); // one failure is not "down"
    await checkUptime(o.orgId, minutes(t0, 2), async () => false); // not due yet (5-minute interval): nothing changes
    const [early] = await db.select().from(deployments).where(eq(deployments.id, id));
    expect(early.uptimeFailures).toBe(1);

    await checkUptime(o.orgId, minutes(t0, 5), async () => false);
    expect((await emitDeploymentFindings(o.orgId)).down).toBe(1);
    expect((await emitDeploymentFindings(o.orgId)).down).toBe(0); // the same spell never raises two
    await checkUptime(o.orgId, minutes(t0, 10), async () => false); // still down: same spell
    expect((await emitDeploymentFindings(o.orgId)).down).toBe(0);

    await checkUptime(o.orgId, minutes(t0, 15), async () => true);
    await sweepActionCenter(o.orgId, minutes(t0, 15));
    expect((await rowsOf(o.orgId, 'deployment_down')).map((r) => r.status)).toEqual(['auto_resolved']);
  });

  it('leaves domains reserved for tests alone, so demo data never looks broken', async () => {
    const { o, id } = await world('crm.aksara.example.test');
    let probed = 0;
    await checkUptime(o.orgId, new Date('2026-10-28T03:00:00Z'), async () => (probed++, false));
    expect(probed).toBe(0);
    const [d] = await db.select().from(deployments).where(eq(deployments.id, id));
    expect(d.uptimeState).toBeNull();
  });
});

describe('code drift (BR-M17-11, -12)', () => {
  const gh = (head: string, ahead: number): GithubClient => ({
    getInstallation: async () => ({ account: 'orbit', repositorySelection: 'selected' }),
    listRepositories: async () => [{ fullName: 'orbit/crm', defaultBranch: 'main' }],
    getBranchHead: async () => head,
    commitsAhead: async () => ahead,
    latestVersion: async () => null,
    installationToken: async () => 'token',
  });

  async function connected() {
    const w = await world();
    await createConnection(w.o.ownerCtx, { kind: 'github', name: 'GitHub', installationId: 4242, verification: sealVerificationForTest(w.o.ownerCtx, [{ id: 4242, account: 'orbit' }]) });
    await db.update(deployments).set({ repo: 'orbit/crm', branch: 'main', deployedCommit: 'aaa1111' }).where(eq(deployments.id, w.id));
    return w;
  }

  it('stores the tip and how far behind, raises one finding per tip, and closes it when the server catches up', async () => {
    const { o, id } = await connected();
    const t0 = new Date('2026-10-28T03:00:00Z');
    expect(await checkCodeDrift(o.orgId, t0, gh('bbb2222', 3))).toEqual({ checked: 1, failed: 0 });
    const [d] = await db.select().from(deployments).where(eq(deployments.id, id));
    expect(d).toMatchObject({ latestCommit: 'bbb2222', behindBy: 3 });
    expect((await emitDeploymentFindings(o.orgId)).outdated).toBe(1);
    expect((await emitDeploymentFindings(o.orgId)).outdated).toBe(0);

    // The server is updated to the tip: the reading drops to 0 and the card closes itself.
    await db.update(deployments).set({ deployedCommit: 'bbb2222' }).where(eq(deployments.id, id));
    await checkCodeDrift(o.orgId, minutes(t0.toISOString(), 5), gh('bbb2222', 0));
    await sweepActionCenter(o.orgId, minutes(t0.toISOString(), 5));
    expect((await rowsOf(o.orgId, 'deployment_outdated')).map((r) => r.status)).toEqual(['auto_resolved']);
  });

  it('does nothing without a GitHub connection, and runOperationChecks skips drift when no App is configured', async () => {
    const { o } = await world();
    expect(await checkCodeDrift(o.orgId, new Date('2026-10-28T03:00:00Z'), gh('bbb2222', 3))).toEqual({ checked: 0, failed: 0 });
    const out = await runOperationChecks(o.orgId, new Date('2026-10-28T03:00:00Z'), { probe: async () => true, gh: null });
    expect(out.drift).toEqual({ checked: 0, failed: 0 });
    expect(out.uptime.checked).toBe(1);
  });
});
