import type { APIRoute } from 'astro';
import { db } from '../../../db/client';
import { getAiOverview } from '../../../domain/ai/service';
import { handle, ok, requireCtx } from '../../../lib/api';

export const prerender = false;

/** Today's AI spend and cap per feature. Managers only. */
export const GET: APIRoute = (context) =>
  handle(async () => {
    const overview = await getAiOverview(db, requireCtx(context));
    return ok({ dayStart: overview.dayStart.toISOString(), features: overview.features });
  });
