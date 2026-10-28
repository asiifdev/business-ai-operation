import type { APIRoute } from 'astro';
import { getTaskFormOptions } from '../../../domain/tasks/service';
import { handle, ok, requireCtx } from '../../../lib/api';

export const prerender = false;

/** `GET /api/tasks/options`: people, clients, products and deployments for the task form. */
export const GET: APIRoute = (context) => handle(async () => ok(await getTaskFormOptions(requireCtx(context))));
