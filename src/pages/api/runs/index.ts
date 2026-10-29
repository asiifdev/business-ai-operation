import type { APIRoute } from 'astro';
import { z } from 'zod';
import { listRuns, planRun } from '../../../domain/flows/service';
import { handle, ok, rateLimit, readJson, requireCtx } from '../../../lib/api';

export const prerender = false;

const body = z.object({ flowId: z.string().min(1).max(40), productId: z.string().min(1).max(40), params: z.record(z.string(), z.unknown()).default({}), bindings: z.record(z.string(), z.string()).default({}) });

export const GET: APIRoute = (context) => handle(async () => ok({ runs: await listRuns(requireCtx(context), { flowId: context.url.searchParams.get('flowId') ?? undefined }) }));

/** `POST /api/runs`: plans a run and asks for approval. Nothing runs yet (BR-M17-21). */
export const POST: APIRoute = (context) =>
  handle(async () => {
    const ctx = requireCtx(context);
    const limited = rateLimit(ctx, 'run-plan', 20, 60_000);
    if (limited) return limited;
    return ok(await planRun(ctx, body.parse(await readJson(context.request))), 201);
  });
