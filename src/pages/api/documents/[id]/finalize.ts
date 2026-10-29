import type { APIRoute } from 'astro';
import { finalizeDocument } from '../../../../domain/documents/service';
import { handle, ok, param, requireCtx } from '../../../../lib/api';

export const prerender = false;

export const POST: APIRoute = (context) => handle(async () => ok(await finalizeDocument(requireCtx(context), param(context, 'id'))));
