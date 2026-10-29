import type { APIRoute } from 'astro';
import { createConnection, listConnections } from '../../../domain/connections/service';
import { handle, ok, readJson, requireCtx } from '../../../lib/api';

export const prerender = false;

/** The list never carries a secret (BR-M17-02). */
export const GET: APIRoute = (context) => handle(async () => ok({ connections: await listConnections(requireCtx(context)) }));

export const POST: APIRoute = (context) => handle(async () => ok(await createConnection(requireCtx(context), (await readJson(context.request)) as never), 201));
