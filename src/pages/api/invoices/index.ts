import type { APIRoute } from 'astro';
import { createInvoiceDraft, listInvoices, type InvoiceRow } from '../../../domain/billing/invoices';
import { handle, ok, readJson, requireCtx } from '../../../lib/api';

export const prerender = false;

const STATUSES = ['draft', 'sent', 'paid', 'void'] as const;

export const GET: APIRoute = (context) =>
  handle(async () => {
    const q = context.url.searchParams;
    const status = q.get('status');
    return ok({
      invoices: await listInvoices(requireCtx(context), {
        status: STATUSES.includes(status as InvoiceRow['status']) ? (status as InvoiceRow['status']) : undefined,
        overdue: q.get('overdue') === '1',
        clientId: q.get('clientId') ?? undefined,
      }),
    });
  });

export const POST: APIRoute = (context) => handle(async () => ok(await createInvoiceDraft(requireCtx(context), (await readJson(context.request)) as never), 201));
