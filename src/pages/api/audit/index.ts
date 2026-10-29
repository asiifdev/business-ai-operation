import type { APIRoute } from 'astro';
import { zonedDayStart } from '../../../domain/ai/budget';
import { listAudit, listAuditEntityTypes } from '../../../domain/audit/read';
import { handle, ok, requireCtx } from '../../../lib/api';

export const prerender = false;

/** `GET /api/audit`: read only. There is no route that changes or deletes an entry (BR-M15-01). */
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** A calendar day in the organization's time zone as the instant it starts. `offsetDays` 1 gives the exclusive end of that day. */
function dayInstant(day: string | undefined, timeZone: string, offsetDays = 0): string | undefined {
  if (!day || !DAY.test(day)) return undefined;
  const noon = new Date(`${day}T12:00:00Z`);
  noon.setUTCDate(noon.getUTCDate() + offsetDays);
  return zonedDayStart(noon, timeZone).toISOString();
}

export const GET: APIRoute = (context) =>
  handle(async () => {
    const ctx = requireCtx(context);
    const q = context.url.searchParams;
    const get = (name: string) => q.get(name) || undefined;
    const [page, entityTypes] = await Promise.all([
      listAudit(ctx, { actor: get('actor') as never, userId: get('userId'), entityType: get('entityType'), entityId: get('entityId'), from: dayInstant(get('from'), context.locals.timezone), to: dayInstant(get('to'), context.locals.timezone, 1), cursor: get('cursor') }),
      q.get('cursor') ? Promise.resolve([]) : listAuditEntityTypes(ctx),
    ]);
    return ok({ ...page, entityTypes });
  });
