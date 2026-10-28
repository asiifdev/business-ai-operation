import { afterAll, describe, expect, it } from 'vitest';
import { pg } from '../../../db/client';
import { makeOrg } from '../../ai/__tests__/support';
import { DomainError } from '../../errors';
import { createClient } from '../../portfolio/clients';
import { createPackage, createProduct } from '../../portfolio/products';
import { createInvoiceDraft, markInvoiceSent } from '../invoices';
import { recordPayment } from '../payments';
import { createSubscription, generateRenewalDrafts } from '../subscriptions';
import { getCalendarMonth, getFinanceSummary } from '../summary';

afterAll(async () => {
  await pg.end();
});

const item = (unitPrice: number) => [{ description: 'Layanan', quantity: 1, unitPrice }];

/** A small history on a moving clock: one paid invoice in September, a part-paid overdue one and one due today in October. */
async function scenario() {
  const o = await makeOrg('2026-09-05T03:00:00Z');
  const client = await createClient(o.ownerCtx, { name: 'Aksara Studio' });
  const other = await createClient(o.ownerCtx, { name: 'Bima Digital' });
  const product = await createProduct(o.ownerCtx, { name: 'Orbit CRM' });
  const pkg = await createPackage(o.ownerCtx, product.id, { name: 'Bisnis', monthlyPrice: 450_000 });

  const a = await createInvoiceDraft(o.ownerCtx, { clientId: client.id, dueDate: '2026-09-20', items: item(1_000_000) });
  await markInvoiceSent(o.ownerCtx, a.id);
  o.clock.set('2026-09-18T03:00:00Z');
  await recordPayment(o.ownerCtx, a.id, { amount: 1_000_000, paidOn: '2026-09-18', method: 'transfer' });

  o.clock.set('2026-10-01T03:00:00Z');
  const b = await createInvoiceDraft(o.ownerCtx, { clientId: client.id, dueDate: '2026-10-15', items: item(2_000_000) });
  await markInvoiceSent(o.ownerCtx, b.id);
  o.clock.set('2026-10-10T03:00:00Z');
  await recordPayment(o.ownerCtx, b.id, { amount: 500_000, paidOn: '2026-10-10', method: 'transfer' });

  o.clock.set('2026-10-20T03:00:00Z');
  const c = await createInvoiceDraft(o.ownerCtx, { clientId: other.id, dueDate: '2026-10-28', items: item(300_000) });
  await markInvoiceSent(o.ownerCtx, c.id);

  await createSubscription(o.ownerCtx, { clientId: client.id, packageId: pkg.id, startedOn: '2026-10-02', nextDueDate: '2026-11-02' });
  await createSubscription(o.ownerCtx, { clientId: other.id, packageId: pkg.id, amount: 900_000, intervalMonths: 3, startedOn: '2026-10-10', nextDueDate: '2027-01-10' });
  o.clock.set('2026-10-28T03:00:00Z');
  await generateRenewalDrafts(o.orgId, o.clock.now());
  return { o, a: a.id, b: b.id, c: c.id, client: client.id };
}

describe('finance summary (dashboard figures)', () => {
  it('derives every figure from invoices, payments and subscriptions', async () => {
    const { o, b, c } = await scenario();
    const s = await getFinanceSummary(o.ownerCtx);
    expect(s.today).toBe('2026-10-28');
    expect(s.month).toBe('2026-10');
    expect(s.mrr).toBe(450_000 + 300_000); // 900.000 over three months is 300.000 a month
    expect(s.activeSubscriptions).toBe(2);
    expect(s.receivedThisMonth).toBe(500_000);
    expect(s.outstanding).toEqual({ amount: 1_500_000 + 300_000, count: 2 });
    expect(s.overdue).toMatchObject({ amount: 1_500_000, count: 1 });
    expect(s.overdue.items[0]).toMatchObject({ id: b, daysOverdue: 13, balance: 1_500_000, number: 'INV-2026-0002' });
    expect(s.dueToday.map((i) => i.id)).toEqual([c]);
    expect(s.renewalsSoon).toMatchObject([{ nextDueDate: '2026-11-02', amount: 450_000 }]);
    expect(s.draftsToReview).toBe(1); // the draft the scheduler prepared
  });

  it('gives six months, oldest first, with money received and invoiced per month', async () => {
    const { o } = await scenario();
    const { series } = await getFinanceSummary(o.ownerCtx);
    expect(series.map((x) => x.month)).toEqual(['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
    expect(series[4]).toEqual({ month: '2026-09', received: 1_000_000, invoiced: 1_000_000 });
    expect(series[5]).toEqual({ month: '2026-10', received: 500_000, invoiced: 2_300_000 });
    expect(series.slice(0, 4).every((x) => x.received === 0 && x.invoiced === 0)).toBe(true);
  });

  it('counts a correction against what was received', async () => {
    const { o, b } = await scenario();
    await recordPayment(o.ownerCtx, b, { kind: 'correction', amount: 100_000, paidOn: '2026-10-28', method: 'transfer' });
    expect((await getFinanceSummary(o.ownerCtx)).receivedThisMonth).toBe(400_000);
  });

  it('is for managers only and never mixes organizations', async () => {
    const { o } = await scenario();
    const err = await getFinanceSummary(o.staffCtx).then(() => null, (e: unknown) => e);
    expect((err as DomainError).code).toBe('forbidden');
    const empty = await makeOrg();
    expect(await getFinanceSummary(empty.ownerCtx)).toMatchObject({ mrr: 0, receivedThisMonth: 0, outstanding: { amount: 0, count: 0 }, overdue: { count: 0 }, dueToday: [], renewalsSoon: [] });
  });
});

describe('operations calendar', () => {
  it('puts invoices and renewals on their day and tells overdue from upcoming and paid', async () => {
    const { o, a, b, c } = await scenario();
    const oct = await getCalendarMonth(o.ownerCtx, '2026-10');
    const byHref = new Map(oct.events.map((e) => [e.href, e]));
    expect(oct.today).toBe('2026-10-28');
    expect(byHref.get(`/app/invoice/${b}`)).toMatchObject({ date: '2026-10-15', kind: 'invoice_overdue', amount: 2_000_000 });
    expect(byHref.get(`/app/invoice/${c}`)).toMatchObject({ date: '2026-10-28', kind: 'invoice_due' });
    expect(byHref.has(`/app/invoice/${a}`)).toBe(false); // due in September
    const sep = await getCalendarMonth(o.ownerCtx, '2026-09');
    expect(sep.events).toMatchObject([{ kind: 'invoice_paid', date: '2026-09-20' }]);
    const nov = await getCalendarMonth(o.ownerCtx, '2026-11');
    expect(nov.events.map((e) => e.kind)).toEqual(expect.arrayContaining(['renewal', 'invoice_draft']));
  });

  it('leaves out cancelled invoices', async () => {
    const { o, client } = await scenario();
    const draft = await createInvoiceDraft(o.ownerCtx, { clientId: client, dueDate: '2026-10-30', items: item(1000) });
    const { cancelInvoice } = await import('../invoices');
    await cancelInvoice(o.ownerCtx, draft.id, { reason: 'salah buat' });
    expect((await getCalendarMonth(o.ownerCtx, '2026-10')).events.some((e) => e.href.endsWith(draft.id))).toBe(false);
  });
});
