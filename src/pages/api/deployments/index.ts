import type { APIRoute } from 'astro';
import { createDeployment, listDeployments } from '../../../domain/portfolio/deployments';
import { handle, ok, readJson, requireCtx } from '../../../lib/api';

export const prerender = false;

export const GET: APIRoute = (context) =>
  handle(async () => {
    const q = context.url.searchParams;
    return ok({ deployments: await listDeployments(requireCtx(context), { clientId: q.get('clientId') ?? undefined, productId: q.get('productId') ?? undefined, behindOnly: q.get('behind') === '1' }) });
  });

export const POST: APIRoute = (context) =>
  handle(async () => ok(await createDeployment(requireCtx(context), (await readJson(context.request)) as never), 201));
