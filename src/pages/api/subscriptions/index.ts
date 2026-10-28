import type { APIRoute } from 'astro';
import { createSubscription, listSubscriptions } from '../../../domain/billing/subscriptions';
import { handle, ok, readJson, requireCtx } from '../../../lib/api';

export const prerender = false;

export const GET: APIRoute = (context) =>
  handle(async () => {
    const q = context.url.searchParams;
    const status = q.get('status');
    return ok({
      subscriptions: await listSubscriptions(requireCtx(context), {
        status: status === 'active' || status === 'stopped' ? status : undefined,
        clientId: q.get('clientId') ?? undefined,
      }),
    });
  });

export const POST: APIRoute = (context) => handle(async () => ok(await createSubscription(requireCtx(context), (await readJson(context.request)) as never), 201));
