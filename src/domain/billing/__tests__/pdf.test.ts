import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { db, pg } from '../../../db/client';
import { organizations } from '../../../db/schema';
import { makeOrg } from '../../ai/__tests__/support';
import { DomainError } from '../../errors';
import { createClient } from '../../portfolio/clients';
import { GET as downloadPdf } from '../../../pages/api/invoices/[id]/pdf';
import { buildInvoiceDocument, renderInvoicePdf } from '../invoice-pdf';
import { createInvoiceDraft, getInvoice, markInvoiceSent } from '../invoices';
import { recordPayment } from '../payments';

afterAll(async () => {
  await pg.end();
});

async function seedInvoice(taxRateBps = 0) {
  const o = await makeOrg();
  await db.update(organizations).set({ taxRateBps, bankName: 'Bank Contoh', bankAccountName: 'PT Orbit Studio', bankAccountNumber: '1234567890' }).where(eq(organizations.id, o.orgId));
  const client = await createClient(o.ownerCtx, { name: 'Aksara Studio', address: 'Jl. Contoh No. 1, Yogyakarta' });
  const { id } = await createInvoiceDraft(o.ownerCtx, {
    clientId: client.id,
    dueDate: '2026-11-10',
    notes: 'Terima kasih atas kepercayaannya.',
    items: [{ description: 'Setup awal', quantity: 1, unitPrice: 1_500_000 }, { description: 'Lisensi bulanan', quantity: 3, unitPrice: 450_000 }],
  });
  return { o, id };
}

describe('invoice PDF (BR-M03-15)', () => {
  it('shows exactly the amounts stored on the invoice, the same ones the screen shows', async () => {
    const { o, id } = await seedInvoice(1100);
    await markInvoiceSent(o.ownerCtx, id);
    const screen = await getInvoice(o.ownerCtx, id);
    const doc = await buildInvoiceDocument(o.ownerCtx, id);
    expect(doc.subtotal).toBe(screen.invoice.subtotal);
    expect(doc.taxAmount).toBe(screen.invoice.taxAmount);
    expect(doc.total).toBe(screen.invoice.total);
    expect(doc).toMatchObject({ subtotal: 2_850_000, taxAmount: 313_500, total: 3_163_500, taxRateBps: 1100, number: 'INV-2026-0001', status: 'sent', paid: 0, balance: 3_163_500 });
    expect(doc.lines.map((l) => l.lineTotal)).toEqual(screen.items.map((i) => i.lineTotal));
    expect(doc.org).toMatchObject({ name: expect.any(String), bank: { name: 'Bank Contoh', accountNumber: '1234567890' } });
    expect(doc.client).toMatchObject({ name: 'Aksara Studio', address: 'Jl. Contoh No. 1, Yogyakarta' });
  });

  it('carries payments and the remaining balance after a part payment', async () => {
    const { o, id } = await seedInvoice();
    await markInvoiceSent(o.ownerCtx, id);
    await recordPayment(o.ownerCtx, id, { amount: 1_000_000, paidOn: '2026-10-28', method: 'transfer' });
    expect(await buildInvoiceDocument(o.ownerCtx, id)).toMatchObject({ total: 2_850_000, paid: 1_000_000, balance: 1_850_000 });
  });

  it('renders a real PDF file for a draft, a sent and a paid invoice, named after the number', async () => {
    const { o, id } = await seedInvoice();
    const draft = await renderInvoicePdf(o.ownerCtx, id);
    expect(draft.buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(draft.buffer.length).toBeGreaterThan(1500);
    expect(draft.filename).toMatch(/^draft-\w{6}\.pdf$/);
    await markInvoiceSent(o.ownerCtx, id);
    await recordPayment(o.ownerCtx, id, { amount: 2_850_000, paidOn: '2026-10-28', method: 'transfer' });
    const paid = await renderInvoicePdf(o.ownerCtx, id);
    expect(paid.filename).toBe('INV-2026-0001.pdf');
    expect(paid.buffer.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('is for managers, and an invoice of another organization is not found', async () => {
    const { o, id } = await seedInvoice();
    const other = await makeOrg();
    for (const [ctx, code] of [[o.staffCtx, 'forbidden'], [other.ownerCtx, 'not_found']] as const) {
      const err = await renderInvoicePdf(ctx, id).then(() => null, (e: unknown) => e);
      expect((err as DomainError).code).toBe(code);
    }
  });

  it('is served as a private attachment through the endpoint', async () => {
    const { o, id } = await seedInvoice();
    await markInvoiceSent(o.ownerCtx, id);
    const res = await downloadPdf({ params: { id }, locals: { ctx: o.adminCtx } } as never);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="INV-2026-0001.pdf"');
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(Buffer.from(await res.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-');
    const staff = await downloadPdf({ params: { id }, locals: { ctx: o.staffCtx } } as never);
    expect(staff.status).toBe(403);
  });
});
