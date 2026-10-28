import type { APIRoute } from 'astro';
import { stopSubscription } from '../../../../domain/billing/subscriptions';
import { handle, ok, param, requireCtx } from '../../../../lib/api';

export const prerender = false;

export const POST: APIRoute = (context) =>
  handle(async () => {
    await stopSubscription(requireCtx(context), param(context, 'id'));
    return ok({ id: param(context, 'id') });
  });
