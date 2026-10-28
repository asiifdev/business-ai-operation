import { afterAll, describe, expect, it } from 'vitest';
import { pg } from '../../../db/client';
import { makeOrg } from '../../ai/__tests__/support';
import { createClient } from '../../portfolio/clients';
import { createDeployment } from '../../portfolio/deployments';
import { createProduct } from '../../portfolio/products';
import { getDashboardOverview } from '../overview';

afterAll(async () => {
  await pg.end();
});

describe('dashboard overview', () => {
  it('counts what exists and lists deployments behind the current version', async () => {
    const o = await makeOrg();
    const p = await createProduct(o.ownerCtx, { name: 'Orbit CRM', currentVersion: '2.0.0' });
    const a = await createClient(o.ownerCtx, { name: 'Aksara Studio' });
    const b = await createClient(o.ownerCtx, { name: 'Bima Digital' });
    await createDeployment(o.ownerCtx, { productId: p.id, clientId: a.id, environment: 'production', installedVersion: '1.9.0' });
    await createDeployment(o.ownerCtx, { productId: p.id, clientId: b.id, environment: 'production', installedVersion: '2.0.0' });
    const ov = await getDashboardOverview(o.ownerCtx);
    expect(ov.counts).toEqual({ clients: 2, products: 1, deployments: 2, behind: 1 });
    expect(ov.behind).toMatchObject([{ clientName: 'Aksara Studio', installedVersion: '1.9.0', productVersion: '2.0.0' }]);
    expect(ov.localHour).toBeGreaterThanOrEqual(0);
    expect(ov.localHour).toBeLessThan(24);
  });

  it('gives managers activity, approvals and AI figures, and staff none of them', async () => {
    // 10:00 in Jakarta, tomorrow: audit rows are stamped by the database clock (now), so the window must reach past today.
    const day = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const o = await makeOrg(`${day}T03:00:00Z`);
    await createClient(o.ownerCtx, { name: 'Aksara Studio' });
    const owner = await getDashboardOverview(o.ownerCtx);
    expect(owner.localHour).toBe(10);
    expect(owner.pendingApprovals).toBe(0);
    expect(owner.ai).toMatchObject({ spentMicroUsd: 0, runsToday: 0 });
    expect(owner.activity?.days).toHaveLength(14);
    expect(owner.activity?.days.at(-1)?.date).toBe(day);
    expect(owner.activity?.days.reduce((s, d) => s + d.count, 0)).toBeGreaterThan(0);
    expect(owner.activity?.recent.some((r) => r.action === 'client.created')).toBe(true);

    const staff = await getDashboardOverview(o.staffCtx);
    expect(staff.counts.clients).toBe(1);
    expect(staff.pendingApprovals).toBeNull();
    expect(staff.ai).toBeNull();
    expect(staff.activity).toBeNull();
  });

  it('never shows another organization\'s numbers', async () => {
    const a = await makeOrg();
    const b = await makeOrg();
    await createClient(a.ownerCtx, { name: 'Hanya Milik A' });
    expect((await getDashboardOverview(b.ownerCtx)).counts.clients).toBe(0);
    expect((await getDashboardOverview(b.ownerCtx)).activity?.recent.every((r) => r.action !== 'client.created')).toBe(true);
  });
});
