import type { APIRoute } from 'astro';
import { createConnection, listConnections } from '../../../domain/connections/service';
import { handle, ok, rateLimit, readJson, requireCtx } from '../../../lib/api';

export const prerender = false;

/** The list never carries a secret (BR-M17-02). */
export const GET: APIRoute = (context) => handle(async () => ok({ connections: await listConnections(requireCtx(context)) }));

export const POST: APIRoute = (context) =>
  handle(async () => {
    const ctx = requireCtx(context);
    const limited = rateLimit(ctx, 'connection-create', 20, 60 * 60_000);
    if (limited) return limited;
    return ok(await createConnection(ctx, (await readJson(context.request)) as never), 201);
  });
