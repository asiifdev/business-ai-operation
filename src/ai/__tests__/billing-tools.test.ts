import { afterAll, describe, expect, it } from 'vitest';
import { pg } from '../../db/client';
import { makeOrg } from '../../domain/ai/__tests__/support';
import { createInvoiceDraft, getInvoice, markInvoiceSent } from '../../domain/billing/invoices';
import { recordPayment } from '../../domain/billing/payments';
import { createSubscription } from '../../domain/billing/subscriptions';
import type { Ctx } from '../../domain/ctx';
import { createClient } from '../../domain/portfolio/clients';
import { createPackage, createProduct } from '../../domain/portfolio/products';
import { ToolRegistry, defineTool } from '../tools/registry';
import { buildAssistantRegistry } from '../tools/catalog';
import { z } from 'zod';

afterAll(async () => {
  await pg.end();
});

const run = async (ctx: Ctx, name: string, args: Record<string, unknown> = {}) => {
  const tool = buildAssistantRegistry().get(name)!;
  return (await (tool.run as (c: Ctx, a: unknown) => Promise<Record<string, any>>)(ctx, tool.args.parse(args))) as Record<string, any>;
};
const asAi = (ctx: Ctx): Ctx => ({ ...ctx, actor: 'ai:run-1', aiRunId: 'run-1' });

async function world() {
  const o = await makeOrg('2026-10-28T03:00:00Z');
  const client = await createClient(o.ownerCtx, { name: 'Aksara Studio' });
  const product = await createProduct(o.ownerCtx, { name: 'Orbit CRM' });
  const pkg = await createPackage(o.ownerCtx, product.id, { name: 'Bisnis', monthlyPrice: 450_000 });
  await createSubscription(o.ownerCtx, { clientId: client.id, packageId: pkg.id, startedOn: '2026-10-01', nextDueDate: '2026-11-01' });
  o.clock.set('2026-10-01T03:00:00Z');
  const draft = await createInvoiceDraft(o.ownerCtx, { clientId: client.id, dueDate: '2026-10-15', items: [{ description: 'Setup', quantity: 1, unitPrice: 2_000_000 }] });
  await markInvoiceSent(o.ownerCtx, draft.id);
  o.clock.set('2026-10-10T03:00:00Z');
  await recordPayment(o.ownerCtx, draft.id, { amount: 500_000, paidOn: '2026-10-10', method: 'transfer' });
  o.clock.set('2026-10-28T03:00:00Z');
  return { o, client: client.id, invoice: draft.id };
}

describe('billing tools read what the pages show', () => {
  it('get_billing_summary reports the month with every amount as text and as an integer', async () => {
    const { o } = await world();
    const s = await run(o.ownerCtx, 'get_billing_summary');
    expect(s).toMatchObject({
      bulan: '2026-10',
      diterimaBulanIni: { teks: 'Rp 500.000', angka: 500_000 },
      pendapatanBerulangPerBulan: { angka: 450_000 },
      belumDibayar: { jumlahInvoice: 1, total: { angka: 1_500_000 } },
      lewatJatuhTempo: { jumlahInvoice: 1, total: { angka: 1_500_000 } },
    });
    expect(s.lewatJatuhTempo.terlama[0]).toMatchObject({ klien: 'Aksara Studio', terlambatHari: 13 });
  });

  it('list_invoices filters, and marks overdue as derived', async () => {
    const { o } = await world();
    const all = await run(o.adminCtx, 'list_invoices');
    expect(all.invoice[0]).toMatchObject({ nomor: 'INV-2026-0001', status: 'terkirim', lewatJatuhTempo: true, terlambatHari: 13, sisa: { angka: 1_500_000 } });
    expect((await run(o.adminCtx, 'list_invoices', { status: 'paid' })).jumlah).toBe(0);
    expect((await run(o.adminCtx, 'list_invoices', { overdueOnly: true })).jumlah).toBe(1);
  });

  it('get_invoice and list_subscriptions give the details and the terms', async () => {
    const { o, invoice } = await world();
    const d = await run(o.ownerCtx, 'get_invoice', { invoiceId: invoice });
    expect(d).toMatchObject({ nomor: 'INV-2026-0001', total: { angka: 2_000_000 }, sudahDibayar: { angka: 500_000 }, sisa: { angka: 1_500_000 } });
    expect(d.pembayaran).toMatchObject([{ jenis: 'pembayaran', jumlah: { angka: 500_000 } }]);
    const subs = await run(o.ownerCtx, 'list_subscriptions', { status: 'active' });
    expect(subs.langganan).toMatchObject([{ klien: 'Aksara Studio', nominal: { angka: 450_000 }, intervalBulan: 1, jatuhTempoBerikutnya: '2026-11-01' }]);
  });

  it('are offered to managers only, and refused for staff even when called directly', async () => {
    const { o } = await world();
    const names = (role: 'owner' | 'admin' | 'staff') => buildAssistantRegistry().specsFor(role).map((s) => s.name);
    for (const n of ['get_billing_summary', 'list_invoices', 'get_invoice', 'list_subscriptions', 'draft_invoice']) {
      expect(names('owner')).toContain(n);
      expect(names('admin')).toContain(n);
      expect(names('staff')).not.toContain(n);
    }
    await expect(run(o.staffCtx, 'list_invoices')).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('draft_invoice (tier draft)', () => {
  it('prepares a flagged draft: no number, not sent, made by the AI run, and never a payment', async () => {
    const { o, client } = await world();
    const out = await run(asAi(o.ownerCtx), 'draft_invoice', { clientId: client, dueDate: '2026-11-20', items: [{ description: 'Pelatihan tim', quantity: 2, unitPrice: 750_000 }] });
    expect(out).toMatchObject({ status: 'draf', total: { angka: 1_500_000 } });
    const d = await getInvoice(o.ownerCtx, out.id);
    expect(d.invoice).toMatchObject({ status: 'draft', number: null, isAiDraft: true });
    expect(d.invoice.createdBy).toBe('ai:run-1');
    expect(d.payments).toHaveLength(0);
  });

  it('is a draft-tier tool, and the tools that would change money stay refused', () => {
    expect(buildAssistantRegistry().get('draft_invoice')!.tier).toBe('draft');
    const registry = new ToolRegistry();
    for (const name of ['record_payment', 'create_payment', 'update_invoice_status', 'send_invoice', 'set_invoice_due_date', 'update_invoice_amount']) {
      expect(() => registry.register(defineTool({ name, description: 'should never be registered', tier: 'read', permission: 'billing.read', args: z.object({}), run: async () => ({}) }))).toThrow(/forbidden/);
    }
  });

  it('refuses a client of another organization', async () => {
    const { o } = await world();
    const other = await makeOrg();
    const foreign = await createClient(other.ownerCtx, { name: 'Klien Lain' });
    await expect(run(asAi(o.ownerCtx), 'draft_invoice', { clientId: foreign.id, dueDate: '2026-11-20', items: [{ description: 'x', quantity: 1, unitPrice: 1000 }] })).rejects.toMatchObject({ code: 'not_found' });
  });
});
