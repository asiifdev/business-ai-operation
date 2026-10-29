import type { APIRoute } from 'astro';
import { getDocumentOptions } from '../../../domain/documents/service';
import { handle, ok, requireCtx } from '../../../lib/api';

export const prerender = false;

export const GET: APIRoute = (context) => handle(async () => ok(await getDocumentOptions(requireCtx(context))));
