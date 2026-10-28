import type { APIRoute } from 'astro';
import { cancelInvoice } from '../../../../domain/billing/invoices';
import { handle, ok, param, readJson, requireCtx } from '../../../../lib/api';

export const prerender = false;

export const POST: APIRoute = (context) =>
  handle(async () => {
    await cancelInvoice(requireCtx(context), param(context, 'id'), (await readJson(context.request)) as never);
    return ok({ id: param(context, 'id') });
  });
