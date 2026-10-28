import type { APIRoute } from 'astro';
import { markInvoiceSent } from '../../../../domain/billing/invoices';
import { handle, ok, param, requireCtx } from '../../../../lib/api';

export const prerender = false;

export const POST: APIRoute = (context) => handle(async () => ok(await markInvoiceSent(requireCtx(context), param(context, 'id'))));
