import { afterAll, describe, expect, it } from 'vitest';
import { pg } from '../../src/db/client';
import { makeOrg } from '../../src/domain/ai/__tests__/support';
import type { Ctx } from '../../src/domain/ctx';
import { createClient } from '../../src/domain/portfolio/clients';
import { createPackage, createProduct } from '../../src/domain/portfolio/products';
import { POST as cancel } from '../../src/pages/api/invoices/[id]/cancel';
import { POST as pay } from '../../src/pages/api/invoices/[id]/payments';
import { POST as send } from '../../src/pages/api/invoices/[id]/send';
import { DELETE as deleteInvoice, GET as getInvoice, PATCH as patchInvoice } from '../../src/pages/api/invoices/[id]';
import { GET as listInvoices, POST as postInvoice } from '../../src/pages/api/invoices/index';
import { POST as stop } from '../../src/pages/api/subscriptions/[id]/stop';
import { GET as getSubscription, PATCH as patchSubscription } from '../../src/pages/api/subscriptions/[id]';
import { GET as listSubscriptions, POST as postSubscription } from '../../src/pages/api/subscriptions/index';

afterAll(async () => {
  await pg.end();
});

type Handler = (c: never) => Response | Promise<Response>;
async function call(handler: Handler, ctx: Ctx | null, { method = 'GET', body, params = {}, query = '' }: { method?: string; body?: unknown; params?: Record<string, string>; query?: string } = {}) {
  const url = new URL(`http://localhost/api/x${query}`);
  const request = new Request(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const res = await handler({ request, url, params, locals: { ctx, user: ctx ? { locale: 'id' } : null } } as never);
  return { status: res.status, body: (await res.json()) as any };
}

describe('billing endpoints', () => {
  it('runs the whole invoice life through the API: draft, send, part payment, full payment', async () => {
    const o = await makeOrg();
    const client = await createClient(o.ownerCtx, { name: 'Aksara Studio' });
    const draft = await call(postInvoice, o.ownerCtx, { method: 'POST', body: { clientId: client.id, dueDate: '2026-11-10', items: [{ description: 'Setup', quantity: 2, unitPrice: 500000 }] } });
    expect(draft.status).toBe(201);
    const id = draft.body.data.id as string;
    expect((await call(patchInvoice, o.ownerCtx, { method: 'PATCH', params: { id }, body: { notes: 'Terima kasih' } })).status).toBe(200);
    expect((await call(send, o.ownerCtx, { method: 'POST', params: { id } })).body.data.number).toBe('INV-2026-0001');
    expect((await call(patchInvoice, o.ownerCtx, { method: 'PATCH', params: { id }, body: { notes: 'ubah' } })).status).toBe(409);
    expect((await call(deleteInvoice, o.ownerCtx, { method: 'DELETE', params: { id } })).status).toBe(409);

    const part = await call(pay, o.ownerCtx, { method: 'POST', params: { id }, body: { amount: 300000, paidOn: '2026-10-28', method: 'transfer' } });
    expect(part).toMatchObject({ status: 201, body: { data: { paid: false, balance: 700000 } } });
    const full = await call(pay, o.adminCtx, { method: 'POST', params: { id }, body: { amount: 700000, paidOn: '2026-10-28', method: 'transfer' } });
    expect(full.body.data).toMatchObject({ paid: true, balance: 0 });
    const view = await call(getInvoice, o.ownerCtx, { params: { id } });
    expect(view.body.data.invoice.status).toBe('paid');
    expect(view.body.data.payments).toHaveLength(2);
    expect((await call(listInvoices, o.ownerCtx, { query: '?status=paid' })).body.data.invoices).toHaveLength(1);
    expect((await call(listInvoices, o.ownerCtx, { query: '?overdue=1' })).body.data.invoices).toHaveLength(0);
  });

  it('answers 400 with field names, 403 for staff, 404 across organizations', async () => {
    const a = await makeOrg();
    const b = await makeOrg();
    const client = await createClient(a.ownerCtx, { name: 'Aksara Studio' });
    const bad = await call(postInvoice, a.ownerCtx, { method: 'POST', body: { clientId: client.id, dueDate: '2026-02-30', items: [] } });
    expect(bad.status).toBe(400);
    expect(bad.body.error.fields.sort()).toEqual(['dueDate', 'items']);
    const body = { clientId: client.id, dueDate: '2026-11-10', items: [{ description: 'x', quantity: 1, unitPrice: 1000 }] };
    expect((await call(postInvoice, a.staffCtx, { method: 'POST', body })).status).toBe(403);
    expect((await call(listInvoices, a.staffCtx)).status).toBe(403);
    const id = (await call(postInvoice, a.ownerCtx, { method: 'POST', body })).body.data.id as string;
    expect((await call(getInvoice, b.ownerCtx, { params: { id } })).status).toBe(404);
    expect((await call(send, b.ownerCtx, { method: 'POST', params: { id } })).status).toBe(404);
    expect((await call(pay, b.ownerCtx, { method: 'POST', params: { id }, body: { amount: 1, paidOn: '2026-10-28', method: 'x' } })).status).toBe(404);
    expect((await call(cancel, a.ownerCtx, { method: 'POST', params: { id }, body: { reason: '' } })).status).toBe(400);
    expect((await call(cancel, a.ownerCtx, { method: 'POST', params: { id }, body: { reason: 'salah buat' } })).status).toBe(200);
  });

  it('creates, changes and stops a subscription', async () => {
    const o = await makeOrg();
    const client = await createClient(o.ownerCtx, { name: 'Aksara Studio' });
    const product = await createProduct(o.ownerCtx, { name: 'Orbit CRM' });
    const pkg = await createPackage(o.ownerCtx, product.id, { name: 'Bisnis', monthlyPrice: 450000 });
    const made = await call(postSubscription, o.ownerCtx, { method: 'POST', body: { clientId: client.id, packageId: pkg.id } });
    expect(made.status).toBe(201);
    const id = made.body.data.id as string;
    expect((await call(patchSubscription, o.ownerCtx, { method: 'PATCH', params: { id }, body: { amount: 500000 } })).status).toBe(200);
    expect((await call(getSubscription, o.ownerCtx, { params: { id } })).body.data.subscription).toMatchObject({ amount: 500000, status: 'active', nextDueDate: '2026-10-28' });
    expect((await call(listSubscriptions, o.ownerCtx, { query: '?status=active' })).body.data.subscriptions).toHaveLength(1);
    expect((await call(stop, o.staffCtx, { method: 'POST', params: { id } })).status).toBe(403);
    expect((await call(stop, o.ownerCtx, { method: 'POST', params: { id } })).status).toBe(200);
    expect((await call(stop, o.ownerCtx, { method: 'POST', params: { id } })).status).toBe(409);
  });
});
