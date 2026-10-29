import { afterAll, describe, expect, it } from 'vitest';
import { pg } from '../../../db/client';
import { makeOrg } from '../../ai/__tests__/support';
import { DomainError } from '../../errors';
import { createPackage, createProduct } from '../../portfolio/products';
import { createClient } from '../../portfolio/clients';
import { createInvoiceDraft } from '../../billing/invoices';
import { PAGE_SIZE, listAudit, listAuditEntityTypes } from '../read';
import { recordAudit } from '../service';
import { db } from '../../../db/client';

afterAll(async () => {
  await pg.end();
});

const rejects = async (promise: Promise<unknown>, code: string) => {
  const err = await promise.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(DomainError);
  expect((err as DomainError).code).toBe(code);
};

describe('M15 audit read', () => {
  it('lists newest first with who did it, filters by entity and actor kind, and is for managers only', async () => {
    const o = await makeOrg();
    const product = await createProduct(o.ownerCtx, { name: 'Orbit CRM' });
    await createPackage(o.adminCtx, product.id, { name: 'Bisnis', monthlyPrice: 450_000 });
    await recordAudit(db, { orgId: o.orgId, actor: 'system:scheduler' }, { action: 'finding.created', entityType: 'finding', entityId: 'f1' });

    const all = await listAudit(o.ownerCtx);
    expect(all.entries.length).toBeGreaterThan(3);
    expect(all.entries[0].action).toBe('finding.created');
    expect(all.entries.find((e) => e.action === 'product.created')?.actorName).toBe('Owner Satu');
    expect(all.entries.find((e) => e.action === 'package.created')?.actorName).toBe('Admin Satu');

    expect((await listAudit(o.ownerCtx, { entityType: 'product' })).entries.every((e) => e.entityType === 'product')).toBe(true);
    expect((await listAudit(o.ownerCtx, { actor: 'system' })).entries.map((e) => e.action)).toEqual(['finding.created']);
    expect((await listAudit(o.ownerCtx, { userId: o.adminCtx.userId })).entries.every((e) => e.actorName === 'Admin Satu')).toBe(true);
    await rejects(listAudit(o.staffCtx), 'forbidden');
  });

  it('pages by keyset without gaps or repeats', async () => {
    const o = await makeOrg();
    for (let i = 0; i < PAGE_SIZE + 7; i++) await recordAudit(db, { orgId: o.orgId, actor: 'system:test' }, { action: 'finding.created', entityType: 'finding', entityId: `e${i}` });
    const first = await listAudit(o.ownerCtx, { actor: 'system' });
    expect(first.entries).toHaveLength(PAGE_SIZE);
    expect(first.nextCursor).not.toBeNull();
    const second = await listAudit(o.ownerCtx, { actor: 'system', cursor: first.nextCursor! });
    expect(second.entries).toHaveLength(7);
    expect(second.nextCursor).toBeNull();
    const ids = [...first.entries, ...second.entries].map((e) => e.entityId);
    expect(new Set(ids).size).toBe(PAGE_SIZE + 7);
  });

  it('filters by time window', async () => {
    const o = await makeOrg();
    await recordAudit(db, { orgId: o.orgId, actor: 'system:test' }, { action: 'finding.created', entityType: 'finding', entityId: 'now' });
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const past = new Date(Date.now() - 86_400_000).toISOString();
    expect((await listAudit(o.ownerCtx, { actor: 'system', from: future })).entries).toHaveLength(0);
    expect((await listAudit(o.ownerCtx, { actor: 'system', to: past })).entries).toHaveLength(0);
    expect((await listAudit(o.ownerCtx, { actor: 'system', from: past, to: future })).entries).toHaveLength(1);
  });

  it('hides invoice, subscription and payment history from an Admin, even when asked for directly', async () => {
    const o = await makeOrg();
    const client = await createClient(o.ownerCtx, { name: 'Aksara Studio' });
    await createInvoiceDraft(o.ownerCtx, { clientId: client.id, dueDate: '2026-11-30', items: [{ description: 'Jasa', quantity: 1, unitPrice: 100_000 }] } as never);
    expect((await listAudit(o.ownerCtx, { entityType: 'invoice' })).entries.length).toBeGreaterThan(0);
    expect((await listAudit(o.adminCtx, { entityType: 'invoice' })).entries).toHaveLength(0);
    expect((await listAudit(o.adminCtx)).entries.some((e) => e.entityType === 'invoice')).toBe(false);
    expect(await listAuditEntityTypes(o.adminCtx)).not.toContain('invoice');
    expect(await listAuditEntityTypes(o.ownerCtx)).toContain('invoice');
  });

  it('never shows another organization\'s entries', async () => {
    const a = await makeOrg();
    const b = await makeOrg();
    await createProduct(a.ownerCtx, { name: 'Rahasia A' });
    const seen = await listAudit(b.ownerCtx);
    expect(seen.entries.every((e) => e.entityType !== 'product')).toBe(true);
  });
});
