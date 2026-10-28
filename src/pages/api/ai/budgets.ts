import type { APIRoute } from 'astro';
import { z } from 'zod';
import { db } from '../../../db/client';
import { setAiBudget } from '../../../domain/ai/budget';
import { AI_FEATURES } from '../../../domain/ai/service';
import { handle, ok, readJson, requireCtx } from '../../../lib/api';

export const prerender = false;

const bodySchema = z.object({
  feature: z.enum(AI_FEATURES as [string, ...string[]]),
  /** Dollars, as people type them (for example 2 or 0.5). Stored as whole micro-USD. */
  limitUsd: z.number().min(0).max(100),
});

/** Sets the daily AI cap of one feature. Owner only; audited by the service. */
export const PUT: APIRoute = (context) =>
  handle(async () => {
    const ctx = requireCtx(context);
    const body = bodySchema.parse(await readJson(context.request));
    await setAiBudget(db, ctx, body.feature as (typeof AI_FEATURES)[number], Math.round(body.limitUsd * 1_000_000));
    return ok({ feature: body.feature });
  });
