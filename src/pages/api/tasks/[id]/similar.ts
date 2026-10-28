import type { APIRoute } from 'astro';
import { findSimilarTasks } from '../../../../domain/tasks/service';
import { handle, ok, param, requireCtx } from '../../../../lib/api';

export const prerender = false;

/** `GET /api/tasks/:id/similar`: tasks that read alike, as suggestions to link (BR-M05-06). */
export const GET: APIRoute = (context) => handle(async () => ok({ similar: await findSimilarTasks(requireCtx(context), { taskId: param(context, 'id') }) }));
