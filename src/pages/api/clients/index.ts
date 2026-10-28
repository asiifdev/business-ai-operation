import type { APIRoute } from 'astro';
import { createClient, listClients } from '../../../domain/portfolio/clients';
import { handle, ok, readJson, requireCtx } from '../../../lib/api';

export const prerender = false;

export const GET: APIRoute = (context) =>
  handle(async () =>
    ok({
      clients: await listClients(requireCtx(context), {
        q: context.url.searchParams.get('q') ?? undefined,
        includeArchived: context.url.searchParams.get('archived') === '1',
      }),
    }),
  );

export const POST: APIRoute = (context) =>
  handle(async () => ok(await createClient(requireCtx(context), (await readJson(context.request)) as never), 201));
