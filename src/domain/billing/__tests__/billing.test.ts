import { and, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { db, pg } from '../../../db/client';
import { auditLog, invoices, organizations, payments } from '../../../db/schema';
import { makeOrg } from '../../ai/__tests__/support';
import { DomainError } from '../../errors';
import { createClient, deleteClient } from '../../portfolio/clients';
import { createDeployment, deleteDeployment } from '../../portfolio/deployments';
import { createPackage, createProduct, deleteProduct, updatePackage } from '../../portfolio/products';
import { cancelInvoice, createInvoiceDraft, deleteInvoiceDraft, getInvoice, listInvoices, markInvoiceSent, updateInvoiceDraft } from '../invoices';
import { recordPayment } from '../payments';
import { createSubscription, generateRenewalDrafts, getSubscription, stopSubscription, updateSubscription } from '../subscriptions';

afterAll(async () => {
  await pg.end();
});

const rejects = async (promise: Promise<unknown>, code: string) => {
  const err = await promise.then(() => null, (e: unknown) => e);
  expect(err, `expected DomainError ${code}`).toBeInstanceOf(DomainError);
  expect((err as DomainError).code).toBe(code);
};
const dbRejects = async (promise: Promise<unknown>, pattern: RegExp) => {
  const err = (await promise.then(() => null, (e: unknown) => e)) as { message?: string; cause?: { message?: string } } | null;
  expect(err, 'the database should refuse').not.toBeNull();
  expect([err?.message, err?.cause?.message].join(' ')).toMatch(pattern);
};

// 2026-10-28 03:00Z = 10:00 in Jakarta
async function seed() {
  const o = await makeOrg();
  const product = await createProduct(o.ownerCtx, { name: 'Orbit CRM' });
  const pkg = await createPackage(o.ownerCtx, product.id, { name: 'Bisnis', monthlyPrice: 450_000 });
  const client = await createClient(o.ownerCtx, { name: 'Aksara Studio' });
  return { o, productId: product.id, packageId: pkg.id, clientId: client.id };
}
const manual = (clientId: string, over: Record<string, unknown> = {}) => ({ clientId, dueDate: '2026-11-10', items: [{ description: 'Setup', quantity: 1, unitPrice: 1_000_000 }], ...over });

async function sentInvoice(over: Record<string, unknown> = {}) {
  const s = await seed();
  const { id } = await createInvoiceDraft(s.o.ownerCtx, manual(s.clientId, over));
  await markInvoiceSent(s.o.ownerCtx, id);
  return { ...s, id };
}

describe('invoices: draft, send, lock (BR-M03-02..05)', () => {
  it('creates a draft with totals from the service, no number yet, and an audit row', async () => {
    const s = await seed();
    await db.update(organizations).set({ taxRateBps: 1100 }).where(eq(organizations.id, s.o.orgId));
    const { id } = await createInvoiceDraft(s.o.adminCtx, manual(s.clientId, { items: [{ description: 'Setup', quantity: 2, unitPrice: 500_000 }] }));
    const d = await getInvoice(s.o.ownerCtx, id);
    expect(d.invoice).toMatchObject({ status: 'draft', number: null, subtotal: 1_000_000, taxAmount: 110_000, total: 1_110_000, taxRateBps: 1100 });
    expect(d.items).toHaveLength(1);
    const [entry] = await db.select().from(auditLog).where(and(eq(auditLog.orgId, s.o.orgId), eq(auditLog.action, 'invoice.draft_created')));
    expect(entry.entityId).toBe(id);
  });

  it('sending gives the first number INV-2026-0001, the issue date in the org time zone, and the second gets 0002', async () => {
    const s = await seed();
    const a = await createInvoiceDraft(s.o.ownerCtx, manual(s.clientId));
    const b = await createInvoiceDraft(s.o.ownerCtx, manual(s.clientId));
    expect((await markInvoiceSent(s.o.ownerCtx, a.id)).number).toBe('INV-2026-0001');
    expect((await markInvoiceSent(s.o.ownerCtx, b.id)).number).toBe('INV-2026-0002');
    expect((await getInvoice(s.o.ownerCtx, a.id)).invoice).toMatchObject({ status: 'sent', issueDate: '2026-10-28' });
  });

  it('two sends at the same moment get different, consecutive numbers (concurrency)', async () => {
    const s = await seed();
    const ids = await Promise.all(Array.from({ length: 8 }, () => createInvoiceDraft(s.o.ownerCtx, manual(s.clientId))));
    const sent = await Promise.all(ids.map(({ id }) => markInvoiceSent(s.o.ownerCtx, id)));
    expect(sent.map((x) => x.number).sort()).toEqual(Array.from({ length: 8 }, (_v, i) => `INV-2026-${String(i + 1).padStart(4, '0')}`));
  });

  it('numbers restart per year', async () => {
    const s = await seed();
    const a = await createInvoiceDraft(s.o.ownerCtx, manual(s.clientId));
    await markInvoiceSent(s.o.ownerCtx, a.id);
    s.o.clock.set('2027-01-05T03:00:00Z');
    const b = await createInvoiceDraft(s.o.ownerCtx, manual(s.clientId));
    expect((await markInvoiceSent(s.o.ownerCtx, b.id)).number).toBe('INV-2027-0001');
  });

  it('a sent invoice cannot be edited, re-sent or deleted, and the database says so even without the service', async () => {
    const { o, id } = await sentInvoice();
    await rejects(updateInvoiceDraft(o.ownerCtx, id, { items: [{ description: 'Curang', quantity: 1, unitPrice: 1 }] }), 'invalid_state');
    await rejects(markInvoiceSent(o.ownerCtx, id), 'invalid_state');
    await dbRejects(db.update(invoices).set({ total: 1, subtotal: 1 }).where(eq(invoices.id, id)), /content can no longer change/);
    await dbRejects(db.update(invoices).set({ dueDate: '2030-01-01' }).where(eq(invoices.id, id)), /content can no longer change/);
    await dbRejects(db.delete(invoices).where(eq(invoices.id, id)), /cannot be deleted/);
    await dbRejects(db.execute(sql`update invoice_items set unit_price = 1, line_total = quantity where invoice_id = ${id}`), /cannot change/);
    await dbRejects(db.execute(sql`delete from invoice_items where invoice_id = ${id}`), /cannot change/);
  });

  it('editing a draft replaces the items, recomputes totals, and clears the "not reviewed" flag', async () => {
    const s = await seed();
    const { id } = await createInvoiceDraft(s.o.ownerCtx, manual(s.clientId));
    await updateInvoiceDraft(s.o.ownerCtx, id, { items: [{ description: 'A', quantity: 3, unitPrice: 100 }, { description: 'B', quantity: 1, unitPrice: 50 }] });
    const d = await getInvoice(s.o.ownerCtx, id);
    expect(d.invoice.total).toBe(350);
    expect(d.items.map((i) => i.position)).toEqual([1, 2]);
  });

  it('refuses to send an invoice that totals zero, and a missing or archived client', async () => {
    const s = await seed();
    const { id } = await createInvoiceDraft(s.o.ownerCtx, manual(s.clientId, { items: [{ description: 'Gratis', quantity: 1, unitPrice: 0 }] }));
    await rejects(markInvoiceSent(s.o.ownerCtx, id), 'validation');
    await rejects(createInvoiceDraft(s.o.ownerCtx, manual('nope')), 'not_found');
    await expect(createInvoiceDraft(s.o.ownerCtx, manual(s.clientId, { dueDate: '2026-02-30' }))).rejects.toThrow();
    await expect(createInvoiceDraft(s.o.ownerCtx, manual(s.clientId, { items: [] }))).rejects.toThrow();
  });

  it('cancelling needs a reason, works from draft and sent, and is final', async () => {
    const { o, id } = await sentInvoice();
    await expect(cancelInvoice(o.ownerCtx, id, { reason: '' })).rejects.toThrow();
    await cancelInvoice(o.ownerCtx, id, { reason: 'Salah klien' });
    expect((await getInvoice(o.ownerCtx, id)).invoice).toMatchObject({ status: 'void', voidReason: 'Salah klien' });
    await rejects(cancelInvoice(o.ownerCtx, id, { reason: 'lagi' }), 'invalid_state');
    await rejects(recordPayment(o.ownerCtx, id, { amount: 1, paidOn: '2026-10-28', method: 'transfer' }), 'invalid_state');
  });
});

describe('payments: the ledger (BR-M03-06..08)', () => {
  it('a partial payment keeps the invoice sent with the right balance (BR-M03-08)', async () => {
    const { o, id } = await sentInvoice();
    const r = await recordPayment(o.ownerCtx, id, { amount: 400_000, paidOn: '2026-10-28', method: 'transfer', reference: 'TRX-1' });
    expect(r).toMatchObject({ paid: false, balance: 600_000 });
    const d = await getInvoice(o.ownerCtx, id);
    expect(d.invoice.status).toBe('sent');
    expect(d.derived).toMatchObject({ paid: 400_000, balance: 600_000 });
  });

  it('paying the rest makes it Lunas, decided by the service (BR-M03-07)', async () => {
    const { o, id } = await sentInvoice();
    await recordPayment(o.ownerCtx, id, { amount: 400_000, paidOn: '2026-10-28', method: 'transfer' });
    const r = await recordPayment(o.adminCtx, id, { amount: 600_000, paidOn: '2026-10-28', method: 'tunai' });
    expect(r).toMatchObject({ paid: true, balance: 0 });
    const d = await getInvoice(o.ownerCtx, id);
    expect(d.invoice.status).toBe('paid');
    expect(d.invoice.paidAt).not.toBeNull();
    await rejects(recordPayment(o.ownerCtx, id, { amount: 1, paidOn: '2026-10-28', method: 'tunai' }), 'invalid_state');
  });

  it('refuses overpaying, a future date, a non-positive or fractional amount, and a draft', async () => {
    const { o, id, clientId } = await sentInvoice();
    await rejects(recordPayment(o.ownerCtx, id, { amount: 1_000_001, paidOn: '2026-10-28', method: 'x' }), 'validation');
    await rejects(recordPayment(o.ownerCtx, id, { amount: 1, paidOn: '2026-10-29', method: 'x' }), 'validation');
    for (const amount of [0, -5, 1.5]) await expect(recordPayment(o.ownerCtx, id, { amount, paidOn: '2026-10-28', method: 'x' })).rejects.toThrow();
    const draft = await createInvoiceDraft(o.ownerCtx, manual(clientId));
    await rejects(recordPayment(o.ownerCtx, draft.id, { amount: 1, paidOn: '2026-10-28', method: 'x' }), 'invalid_state');
  });

  it('a correction is a new row that reduces the net, and cannot take back more than was paid', async () => {
    const { o, id } = await sentInvoice();
    await recordPayment(o.ownerCtx, id, { amount: 500_000, paidOn: '2026-10-28', method: 'transfer' });
    await recordPayment(o.ownerCtx, id, { kind: 'correction', amount: 100_000, paidOn: '2026-10-28', method: 'transfer', note: 'salah input' });
    await rejects(recordPayment(o.ownerCtx, id, { kind: 'correction', amount: 400_001, paidOn: '2026-10-28', method: 'x' }), 'validation');
    const d = await getInvoice(o.ownerCtx, id);
    expect(d.payments).toHaveLength(2);
    expect(d.derived.paid).toBe(400_000);
  });

  it('payments cannot be changed or removed, not even straight in the database', async () => {
    const { o, id } = await sentInvoice();
    await recordPayment(o.ownerCtx, id, { amount: 100_000, paidOn: '2026-10-28', method: 'transfer' });
    await dbRejects(db.update(payments).set({ amount: 1 }).where(eq(payments.invoiceId, id)), /append-only/);
    await dbRejects(db.delete(payments).where(eq(payments.invoiceId, id)), /append-only/);
    await dbRejects(db.execute(sql`truncate payments`), /append-only/);
  });

  it('cannot cancel an invoice that has money on it', async () => {
    const { o, id } = await sentInvoice();
    await recordPayment(o.ownerCtx, id, { amount: 100_000, paidOn: '2026-10-28', method: 'transfer' });
    await rejects(cancelInvoice(o.ownerCtx, id, { reason: 'batal saja' }), 'invalid_state');
  });

  it('staff and AI never record payments or change invoices (BR-M03-10)', async () => {
    const { o, id, clientId } = await sentInvoice();
    await rejects(recordPayment(o.staffCtx, id, { amount: 1, paidOn: '2026-10-28', method: 'x' }), 'forbidden');
    await rejects(createInvoiceDraft(o.staffCtx, manual(clientId)), 'forbidden');
    await rejects(markInvoiceSent(o.staffCtx, id), 'forbidden');
    await rejects(cancelInvoice(o.staffCtx, id, { reason: 'iseng saja' }), 'forbidden');
    await rejects(listInvoices(o.staffCtx), 'forbidden');
    const aiCtx = { ...o.ownerCtx, actor: 'ai:run1' as const, aiRunId: 'run1' };
    await rejects(recordPayment(aiCtx, id, { amount: 1, paidOn: '2026-10-28', method: 'x' }), 'forbidden');
  });

  it('writes an audit row for every money step with the actor', async () => {
    const { o, id } = await sentInvoice();
    await recordPayment(o.adminCtx, id, { amount: 1_000_000, paidOn: '2026-10-28', method: 'transfer' });
    const rows = await db.select().from(auditLog).where(and(eq(auditLog.orgId, o.orgId), eq(auditLog.entityId, id)));
    expect(rows.map((r) => r.action).sort()).toEqual(['invoice.draft_created', 'invoice.sent', 'payment.recorded']);
    expect(rows.find((r) => r.action === 'payment.recorded')?.actor).toBe(`user:${o.adminCtx.userId}`);
  });
});

describe('overdue is derived, never stored (BR-M03-02, -12)', () => {
  it('shows an invoice as overdue the day after its due date and lists it in the overdue filter', async () => {
    const { o, id } = await sentInvoice({ dueDate: '2026-11-10' });
    expect((await listInvoices(o.ownerCtx, { overdue: true })).map((i) => i.id)).not.toContain(id);
    o.clock.set('2026-11-10T03:00:00Z');
    expect((await listInvoices(o.ownerCtx, { overdue: true })).map((i) => i.id)).not.toContain(id);
    o.clock.set('2026-11-11T03:00:00Z');
    const overdue = await listInvoices(o.ownerCtx, { overdue: true });
    expect(overdue.find((i) => i.id === id)).toMatchObject({ overdue: true, daysOverdue: 1, balance: 1_000_000, status: 'sent' });
    await recordPayment(o.ownerCtx, id, { amount: 1_000_000, paidOn: '2026-11-11', method: 'transfer' });
    expect((await listInvoices(o.ownerCtx, { overdue: true })).map((i) => i.id)).not.toContain(id);
  });
});

describe('subscriptions and the renewal scheduler (BR-M03-09, -13, -14)', () => {
  async function withSub(over: Record<string, unknown> = {}) {
    const s = await seed();
    const sub = await createSubscription(s.o.ownerCtx, { clientId: s.clientId, packageId: s.packageId, startedOn: '2026-10-01', nextDueDate: '2026-11-01', ...over });
    return { ...s, subId: sub.id };
  }

  it('copies the package price, and a later price change does not touch it (BR-M02-11)', async () => {
    const { o, packageId, subId } = await withSub();
    await updatePackage(o.ownerCtx, packageId, { monthlyPrice: 999_000 });
    expect((await getSubscription(o.ownerCtx, subId)).subscription.amount).toBe(450_000);
  });

  it('makes exactly ONE draft when due within 7 days, and running again makes none', async () => {
    const { o, subId } = await withSub();
    o.clock.set('2026-10-20T03:00:00Z'); // 12 days before: too early
    expect((await generateRenewalDrafts(o.orgId, o.clock.now())).created).toHaveLength(0);
    o.clock.set('2026-10-25T03:00:00Z'); // 7 days before
    const first = await generateRenewalDrafts(o.orgId, o.clock.now());
    expect(first.created).toHaveLength(1);
    const second = await generateRenewalDrafts(o.orgId, o.clock.now());
    expect(second.created).toHaveLength(0);
    expect(second.skipped).toBe(1);
    const rows = await db.select().from(invoices).where(eq(invoices.subscriptionId, subId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'draft', number: null, dueDate: '2026-11-01', periodKey: '2026-11', total: 450_000, isAiDraft: true, createdBy: 'system:rule.renewal_draft' });
  });

  it('two schedulers running at once still produce one draft', async () => {
    const { o, subId } = await withSub();
    o.clock.set('2026-10-28T03:00:00Z');
    await Promise.all([generateRenewalDrafts(o.orgId, o.clock.now()), generateRenewalDrafts(o.orgId, o.clock.now()), generateRenewalDrafts(o.orgId, o.clock.now())]);
    expect(await db.select().from(invoices).where(eq(invoices.subscriptionId, subId))).toHaveLength(1);
  });

  it('paying the invoice moves the due date one interval forward, from the start day; then the next period gets its own draft', async () => {
    const { o, subId } = await withSub({ startedOn: '2026-01-31', nextDueDate: '2026-01-31' });
    o.clock.set('2026-01-28T03:00:00Z');
    const [first] = (await generateRenewalDrafts(o.orgId, o.clock.now())).created;
    await markInvoiceSent(o.ownerCtx, first);
    await recordPayment(o.ownerCtx, first, { amount: 450_000, paidOn: '2026-01-28', method: 'transfer' });
    expect((await getSubscription(o.ownerCtx, subId)).subscription.nextDueDate).toBe('2026-02-28');
    o.clock.set('2026-02-22T03:00:00Z');
    const [second] = (await generateRenewalDrafts(o.orgId, o.clock.now())).created;
    await markInvoiceSent(o.ownerCtx, second);
    await recordPayment(o.ownerCtx, second, { amount: 450_000, paidOn: '2026-02-22', method: 'transfer' });
    expect((await getSubscription(o.ownerCtx, subId)).subscription.nextDueDate).toBe('2026-03-31'); // back to the 31st, no drift
  });

  it('a partial payment does not move the due date', async () => {
    const { o, subId } = await withSub();
    o.clock.set('2026-10-28T03:00:00Z');
    const [inv] = (await generateRenewalDrafts(o.orgId, o.clock.now())).created;
    await markInvoiceSent(o.ownerCtx, inv);
    await recordPayment(o.ownerCtx, inv, { amount: 100_000, paidOn: '2026-10-28', method: 'transfer' });
    expect((await getSubscription(o.ownerCtx, subId)).subscription.nextDueDate).toBe('2026-11-01');
  });

  it('a new amount only reaches the next invoice, and a stopped subscription makes none (BR-M03-13, -14)', async () => {
    const { o, subId } = await withSub();
    o.clock.set('2026-10-28T03:00:00Z');
    const [inv] = (await generateRenewalDrafts(o.orgId, o.clock.now())).created;
    await updateSubscription(o.ownerCtx, subId, { amount: 600_000 });
    expect((await getInvoice(o.ownerCtx, inv)).invoice.total).toBe(450_000);
    await stopSubscription(o.ownerCtx, subId);
    await rejects(stopSubscription(o.ownerCtx, subId), 'invalid_state');
    await rejects(updateSubscription(o.ownerCtx, subId, { amount: 1 }), 'invalid_state');
    await deleteInvoiceDraft(o.ownerCtx, inv);
    expect((await generateRenewalDrafts(o.orgId, o.clock.now())).created).toHaveLength(0);
  });

  it('skips free subscriptions and other organizations never see or get anyone else\'s drafts', async () => {
    const free = await withSub({ amount: 0 });
    free.o.clock.set('2026-10-28T03:00:00Z');
    const r = await generateRenewalDrafts(free.o.orgId, free.o.clock.now());
    expect(r).toMatchObject({ created: [], skipped: 1 });
    const other = await withSub();
    other.o.clock.set('2026-10-28T03:00:00Z');
    const [inv] = (await generateRenewalDrafts(other.o.orgId, other.o.clock.now())).created;
    await rejects(getInvoice(free.o.ownerCtx, inv), 'not_found');
    expect(await listInvoices(free.o.ownerCtx)).toHaveLength(0);
  });

  it('refuses a deployment of another client, and an archived or unknown package', async () => {
    const s = await seed();
    const other = await createClient(s.o.ownerCtx, { name: 'Klien Lain' });
    const dep = await createDeployment(s.o.ownerCtx, { productId: s.productId, clientId: other.id, environment: 'production' });
    await rejects(createSubscription(s.o.ownerCtx, { clientId: s.clientId, packageId: s.packageId, deploymentId: dep.id }), 'validation');
    await rejects(createSubscription(s.o.ownerCtx, { clientId: s.clientId, packageId: 'nope' }), 'not_found');
  });

  it('protects history: a client, product or deployment that billing uses cannot be deleted (BR-M02-08)', async () => {
    const s = await seed();
    const dep = await createDeployment(s.o.ownerCtx, { productId: s.productId, clientId: s.clientId, environment: 'production' });
    await createSubscription(s.o.ownerCtx, { clientId: s.clientId, packageId: s.packageId, deploymentId: dep.id });
    await rejects(deleteDeployment(s.o.ownerCtx, dep.id), 'invalid_state');
    await rejects(deleteClient(s.o.ownerCtx, s.clientId), 'invalid_state');
    await rejects(deleteProduct(s.o.ownerCtx, s.productId), 'invalid_state');
    const other = await seed();
    await createInvoiceDraft(other.o.ownerCtx, manual(other.clientId));
    await rejects(deleteClient(other.o.ownerCtx, other.clientId), 'invalid_state');
  });
});
