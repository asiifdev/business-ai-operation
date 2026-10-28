import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getCalendarMonth } from '../../../domain/billing/summary';
import { handle, ok, requireCtx } from '../../../lib/api';

export const prerender = false;

const query = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) });

/** `GET /api/dashboard/calendar?month=2026-11`: invoices and renewals falling in that month. */
export const GET: APIRoute = (context) =>
  handle(async () => {
    const { month } = query.parse({ month: context.url.searchParams.get('month') });
    return ok(await getCalendarMonth(requireCtx(context), month));
  });
