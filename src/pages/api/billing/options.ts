import type { APIRoute } from 'astro';
import { getBillingFormOptions } from '../../../domain/billing/invoices';
import { handle, ok, requireCtx } from '../../../lib/api';

export const prerender = false;

/** `GET /api/billing/options`: clients, packages and the tax rate for the invoice and subscription forms. */
export const GET: APIRoute = (context) => handle(async () => ok(await getBillingFormOptions(requireCtx(context))));
