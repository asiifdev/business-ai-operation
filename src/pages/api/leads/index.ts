import type { APIRoute } from 'astro';
import { z } from 'zod';
import { createLead, getPipelineSummary, listLeads } from '../../../domain/pipeline/leads';
import { STAGES } from '../../../domain/pipeline/stages';
import { handle, ok, readJson, requireCtx } from '../../../lib/api';

export const prerender = false;

const query = z.object({ stage: z.enum(STAGES).optional() });

/** `GET /api/leads`: every lead with its derived state, plus the pipeline numbers from the one calculator. */
export const GET: APIRoute = (context) =>
  handle(async () => {
    const ctx = requireCtx(context);
    const { stage } = query.parse({ stage: context.url.searchParams.get('stage') ?? undefined });
    const [leads, summary] = await Promise.all([listLeads(ctx, { stage, includeArchived: context.url.searchParams.get('archived') === '1' }), getPipelineSummary(ctx)]);
    return ok({ leads, summary });
  });

export const POST: APIRoute = (context) =>
  handle(async () => ok(await createLead(requireCtx(context), (await readJson(context.request)) as never), 201));
