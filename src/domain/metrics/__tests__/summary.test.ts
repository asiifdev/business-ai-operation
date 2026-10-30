import { afterAll, describe, expect, it } from 'vitest';
import { pg } from '../../../db/client';
import { collectBriefingFacts } from '../../action-center/briefing';
import { makeOrg } from '../../ai/__tests__/support';
import { buildAssistantRegistry } from '../../../ai/tools/catalog';
import { createInvoiceDraft, listInvoices, markInvoiceSent } from '../../billing/invoices';
import { recordPayment } from '../../billing/payments';
import { createSubscription } from '../../billing/subscriptions';
import type { Ctx } from '../../ctx';
import { getDashboardOverview } from '../../dashboard/overview';
import { createLead } from '../../pipeline/leads';
import { createClient } from '../../portfolio/clients';
import { createPackage, createProduct } from '../../portfolio/products';
import { createTask } from '../../tasks/service';
import { getBusinessSummary } from '../summary';

afterAll(async () => {
  await pg.end();
});

const aiCtx = (ctx: Ctx): Ctx => ({ ...ctx, actor: 'ai:run-1', aiRunId: 'run-1' });

/**
 * One organization whose numbers can be worked out by hand (BRD-M12 §10). Starts 2026-10-28 10:00 Jakarta, then moves to
 * 2026-11-05 so the first invoice and the first task are late.
 */
async function seeded() {
  const o = await makeOrg();
  const product = await createProduct(o.ownerCtx, { name: 'Orbit CRM' });
  const pkg = await createPackage(o.ownerCtx, product.id, { name: 'Bisnis', monthlyPrice: 450_000 });
  const a = await createClient(o.ownerCtx, { name: 'Aksara Studio' });
  const b = await createClient(o.ownerCtx, { name: 'Bima Digital' });
  await createClient(o.ownerCtx, { name: 'Tanpa Langganan' });

  // MRR: 450.000 monthly + 1.200.000 yearly spread over 12 months (100.000) = 550.000. Two clients have a subscription.
  await createSubscription(o.ownerCtx, { clientId: a.id, packageId: pkg.id });
  await createSubscription(o.ownerCtx, { clientId: b.id, packageId: pkg.id, amount: 1_200_000, intervalMonths: 12 });

  // Outstanding: (1.000.000 − 400.000 paid) + 1.000.000 = 1.600.000 over 2 invoices; the draft does not count.
  const item = [{ description: 'Setup', quantity: 1, unitPrice: 1_000_000 }];
  const x = await createInvoiceDraft(o.ownerCtx, { clientId: a.id, dueDate: '2026-11-01', items: item });
  await markInvoiceSent(o.ownerCtx, x.id);
  await recordPayment(o.ownerCtx, x.id, { amount: 400_000, paidOn: '2026-10-28', method: 'transfer' });
  const y = await createInvoiceDraft(o.ownerCtx, { clientId: b.id, dueDate: '2026-11-30', items: item });
  await markInvoiceSent(o.ownerCtx, y.id);
  await createInvoiceDraft(o.ownerCtx, { clientId: b.id, dueDate: '2026-11-30', items: [{ description: 'Draf', quantity: 1, unitPrice: 9_000_000 }] });

  // Pipeline: 5.000.000 + 2.000.000 = 7.000.000 over 2 leads; the AI draft of 8.000.000 does not count (BR-M12-07).
  await createLead(o.ownerCtx, { name: 'Toko Sinar', estimatedValue: 5_000_000 });
  await createLead(o.ownerCtx, { name: 'Klinik Sehat', estimatedValue: 2_000_000 });
  await createLead(aiCtx(o.ownerCtx), { name: 'Dari Rekaman', estimatedValue: 8_000_000 });

  // Tasks: 2 open (1 late after the clock moves, 1 assigned to Staff); the AI draft does not count.
  await createTask(o.ownerCtx, { title: 'Perbaiki pengingat', dueDate: '2026-11-01' });
  await createTask(o.ownerCtx, { title: 'Siapkan materi', dueDate: '2026-12-01', assigneeId: o.staffCtx.userId });
  await createTask(aiCtx(o.ownerCtx), { title: 'Usulan dari rapat', dueDate: '2026-11-02' });

  o.clock.set('2026-11-05T03:00:00Z');
  return o;
}

describe('business summary (BRD-M12)', () => {
  it('matches the numbers worked out by hand, and leaves drafts out', async () => {
    const o = await seeded();
    const s = await getBusinessSummary(o.ownerCtx);
    expect(s.today).toBe('2026-11-05');
    expect(s.computedAt).toBe('2026-11-05T03:00:00.000Z');
    expect(s.money).toEqual({
      mrr: 550_000,
      activeSubscriptions: 2,
      outstanding: { amount: 1_600_000, count: 2 },
      overdue: { amount: 600_000, count: 1 },
      receivedThisMonth: 0,
    });
    expect(s.pipeline).toEqual({ value: 7_000_000, openLeads: 2, stagnant: 0 });
    expect(s.clients).toEqual({ active: 2 });
    expect(s.tasks).toMatchObject({ open: 2, late: 1 });
  });

  it('changes Outstanding as soon as a payment is recorded (no cache)', async () => {
    const o = await seeded();
    const before = await getBusinessSummary(o.ownerCtx);
    const [late] = (await listInvoices(o.ownerCtx, { overdue: true })).filter((i) => i.overdue);
    await recordPayment(o.ownerCtx, late.id, { amount: 600_000, paidOn: '2026-11-05', method: 'transfer' });
    const after = await getBusinessSummary(o.ownerCtx);
    expect(after.money?.outstanding).toEqual({ amount: before.money!.outstanding.amount - 600_000, count: 1 });
    expect(after.money?.overdue).toEqual({ amount: 0, count: 0 });
    expect(after.money?.receivedThisMonth).toBe(600_000);
  });

  it('gives Staff the operations numbers and no money', async () => {
    const o = await seeded();
    const s = await getBusinessSummary(o.staffCtx);
    expect(s.money).toBeNull();
    expect(s.pipeline.value).toBe(7_000_000);
    expect(s.tasks).toEqual({ open: 2, late: 1, mine: 1 });
  });

  it('shows the same numbers on the dashboard, in the briefing and in the assistant tool (BR-M12-01)', async () => {
    const o = await seeded();
    const s = await getBusinessSummary(o.ownerCtx);
    const dashboard = await getDashboardOverview(o.ownerCtx);
    expect({ ...dashboard.summary, computedAt: s.computedAt }).toEqual(s);
    const facts = await collectBriefingFacts(o.ownerCtx);
    expect(facts).toMatchObject({ mrr: s.money!.mrr, outstanding: s.money!.outstanding, overdue: s.money!.overdue, pipelineValue: s.pipeline.value, activeClients: s.clients.active, openTasks: s.tasks.open, lateTasks: s.tasks.late });
    const tool = buildAssistantRegistry().get('get_business_summary')!;
    const out = (await (tool.run as (c: Ctx, a: unknown) => Promise<Record<string, any>>)(o.ownerCtx, tool.args.parse({}))) as Record<string, any>;
    expect(out.pendapatanBerulangPerBulan.angka).toBe(s.money!.mrr);
    expect(out.belumDibayar.total.angka).toBe(s.money!.outstanding.amount);
    expect(out.pipeline.nilaiTerbuka.angka).toBe(s.pipeline.value);
    expect(out.tugas).toEqual({ terbuka: s.tasks.open, terlambat: s.tasks.late, untukSaya: s.tasks.mine });
  });

  it("never shows another organization's numbers", async () => {
    await seeded();
    const other = await makeOrg('2026-11-05T03:00:00Z');
    const s = await getBusinessSummary(other.ownerCtx);
    expect(s.money).toMatchObject({ mrr: 0, outstanding: { amount: 0, count: 0 }, overdue: { amount: 0, count: 0 } });
    expect(s.pipeline.value).toBe(0);
    expect(s.clients.active).toBe(0);
    expect(s.tasks.open).toBe(0);
  });
});
