import type { APIRoute } from 'astro';
import { getRun } from '../../../domain/flows/service';
import { handle, ok, param, requireCtx } from '../../../lib/api';

export const prerender = false;

export const GET: APIRoute = (context) => handle(async () => ok(await getRun(requireCtx(context), param(context, 'id'))));
