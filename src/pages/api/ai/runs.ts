import type { APIRoute } from 'astro';
import { z } from 'zod';
import { db } from '../../../db/client';
import { listAiRuns } from '../../../domain/ai/service';
import { handle, ok, requireCtx } from '../../../lib/api';

export const prerender = false;

const query = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.coerce.date().optional(),
});

/** The AI run trail: managers see all runs, staff their own. */
export const GET: APIRoute = (context) =>
  handle(async () => {
    const params = query.parse(Object.fromEntries(context.url.searchParams));
    const runs = await listAiRuns(db, requireCtx(context), params);
    return ok({ runs: runs.map((r) => ({ ...r, startedAt: r.startedAt.toISOString(), finishedAt: r.finishedAt?.toISOString() ?? null })) });
  });
