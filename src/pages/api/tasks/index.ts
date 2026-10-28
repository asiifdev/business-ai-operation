import type { APIRoute } from 'astro';
import { createTask, getTaskSummary, listTasks, taskFilterSchema } from '../../../domain/tasks/service';
import { handle, ok, readJson, requireCtx } from '../../../lib/api';

export const prerender = false;

const flag = (v: string | null) => (v === '1' ? true : undefined);

/** `GET /api/tasks`: tasks with their derived state (late, next statuses) and the counts from the one calculator. */
export const GET: APIRoute = (context) =>
  handle(async () => {
    const ctx = requireCtx(context);
    const p = context.url.searchParams;
    const filter = taskFilterSchema.parse({
      status: p.get('status') ?? undefined,
      kind: p.get('kind') ?? undefined,
      assignee: p.get('assignee') ?? undefined,
      clientId: p.get('clientId') ?? undefined,
      productId: p.get('productId') ?? undefined,
      deploymentId: p.get('deploymentId') ?? undefined,
      leadId: p.get('leadId') ?? undefined,
      late: flag(p.get('late')),
      includeDone: flag(p.get('done')),
    });
    const [tasks, summary] = await Promise.all([listTasks(ctx, filter), getTaskSummary(ctx)]);
    return ok({ tasks, summary });
  });

export const POST: APIRoute = (context) =>
  handle(async () => ok(await createTask(requireCtx(context), (await readJson(context.request)) as never), 201));
