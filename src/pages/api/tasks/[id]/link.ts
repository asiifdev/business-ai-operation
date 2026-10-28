import type { APIRoute } from 'astro';
import { z } from 'zod';
import { linkRelatedTask } from '../../../../domain/tasks/service';
import { handle, ok, param, readJson, requireCtx } from '../../../../lib/api';

export const prerender = false;

const body = z.object({ relatedTo: z.string().min(1).max(40).nullable() });

/** Links this task to a related one, or removes the link with `null`. Nothing is merged or deleted (BR-M05-06). */
export const POST: APIRoute = (context) =>
  handle(async () => {
    const { relatedTo } = body.parse(await readJson(context.request));
    await linkRelatedTask(requireCtx(context), param(context, 'id'), relatedTo);
    return ok({ id: param(context, 'id'), relatedTo });
  });
