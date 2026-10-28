import type { APIRoute } from 'astro';
import { setFindingStatus } from '../../../../domain/action-center/findings';
import { handle, ok, param, readJson, requireCtx } from '../../../../lib/api';

export const prerender = false;

/** Handled, ignored, or snoozed for a number of days. */
export const POST: APIRoute = (context) => handle(async () => ok(await setFindingStatus(requireCtx(context), param(context, 'id'), (await readJson(context.request)) as never)));
