import type { APIRoute } from 'astro';
import { z } from 'zod';
import { TASK_STATUSES } from '../../../../domain/tasks/rules';
import { setTaskStatus } from '../../../../domain/tasks/service';
import { handle, ok, param, readJson, requireCtx } from '../../../../lib/api';

export const prerender = false;

const body = z.object({ to: z.enum(TASK_STATUSES) });

export const POST: APIRoute = (context) =>
  handle(async () => {
    const { to } = body.parse(await readJson(context.request));
    return ok(await setTaskStatus(requireCtx(context), param(context, 'id'), to));
  });
