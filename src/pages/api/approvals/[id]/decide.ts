import type { APIRoute } from 'astro';
import { decideApproval } from '../../../../domain/action-center/approvals';
import { handle, ok, param, readJson, requireCtx } from '../../../../lib/api';

export const prerender = false;

/** Approve or reject. 409 `already_decided` or `expired` when someone else was first or the time ran out. */
export const POST: APIRoute = (context) => handle(async () => ok(await decideApproval(requireCtx(context), param(context, 'id'), (await readJson(context.request)) as never)));
