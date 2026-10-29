import type { APIRoute } from 'astro';
import { z } from 'zod';
import { testConnection } from '../../../../domain/connections/service';
import { handle, ok, param, rateLimit, readJson, requireCtx } from '../../../../lib/api';

export const prerender = false;

const body = z.object({ acceptHostKey: z.string().max(200).optional() });

/** `POST /api/connections/:id/test`: the owner tests a connection. For SSH the first call only returns the host fingerprint. */
export const POST: APIRoute = (context) =>
  handle(async () => {
    const ctx = requireCtx(context);
    const limited = rateLimit(ctx, 'connection-test', 10, 60_000);
    if (limited) return limited;
    const parsed = body.parse(context.request.headers.get('content-type')?.includes('application/json') ? await readJson(context.request) : {});
    return ok(await testConnection(ctx, param(context, 'id'), parsed));
  });
