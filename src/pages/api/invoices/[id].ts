import type { APIRoute } from 'astro';
import { deleteInvoiceDraft, getInvoice, updateInvoiceDraft } from '../../../domain/billing/invoices';
import { handle, ok, param, readJson, requireCtx } from '../../../lib/api';

export const prerender = false;

export const GET: APIRoute = (context) => handle(async () => ok(await getInvoice(requireCtx(context), param(context, 'id'))));

export const PATCH: APIRoute = (context) =>
  handle(async () => {
    await updateInvoiceDraft(requireCtx(context), param(context, 'id'), (await readJson(context.request)) as never);
    return ok({ id: param(context, 'id') });
  });

export const DELETE: APIRoute = (context) =>
  handle(async () => {
    await deleteInvoiceDraft(requireCtx(context), param(context, 'id'));
    return ok({ id: param(context, 'id') });
  });
