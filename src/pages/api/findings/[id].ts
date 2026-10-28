import type { APIRoute } from 'astro';
import { getFinding, updateFindingDraft } from '../../../domain/action-center/findings';
import { handle, ok, param, readJson, requireCtx } from '../../../lib/api';

export const prerender = false;

export const GET: APIRoute = (context) => handle(async () => ok(await getFinding(requireCtx(context), param(context, 'id'))));

/** "Edit draft": saves the client message the person changed. Nothing is sent (BR-M08-09). */
export const PATCH: APIRoute = (context) =>
  handle(async () => {
    await updateFindingDraft(requireCtx(context), param(context, 'id'), (await readJson(context.request)) as never);
    return ok({ saved: true });
  });
