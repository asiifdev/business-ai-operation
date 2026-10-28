import type { APIRoute } from 'astro';
import { renderInvoicePdf } from '../../../../domain/billing/invoice-pdf';
import { handle, param, requireCtx } from '../../../../lib/api';

export const prerender = false;

/** `GET /api/invoices/:id/pdf`: the invoice as a PDF, built from the stored data. Needs `billing.read`. */
export const GET: APIRoute = (context) =>
  handle(async () => {
    const { buffer, filename } = await renderInvoicePdf(requireCtx(context), param(context, 'id'));
    return new Response(new Uint8Array(buffer), {
      headers: { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="${filename}"`, 'cache-control': 'private, no-store' },
    });
  });
