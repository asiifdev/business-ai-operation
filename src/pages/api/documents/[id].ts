import type { APIRoute } from 'astro';
import { deleteDraft, getDocument, updateDraft } from '../../../domain/documents/service';
import { handle, ok, param, readJson, requireCtx } from '../../../lib/api';

export const prerender = false;

export const GET: APIRoute = (context) => handle(async () => ok(await getDocument(requireCtx(context), param(context, 'id'))));

export const PATCH: APIRoute = (context) => handle(async () => ok(await updateDraft(requireCtx(context), param(context, 'id'), (await readJson(context.request)) as never)));

export const DELETE: APIRoute = (context) =>
  handle(async () => {
    await deleteDraft(requireCtx(context), param(context, 'id'));
    return ok({ id: param(context, 'id') });
  });
