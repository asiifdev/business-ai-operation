import type { APIRoute } from 'astro';
import { z } from 'zod';
import { deleteSession, getSession, renameSession } from '../../../../domain/assistant/sessions';
import { handle, ok, readJson, requireCtx } from '../../../../lib/api';

export const prerender = false;

const patch = z.object({ title: z.string() });

/** `GET`: one conversation with all its turns. Only its owner can read it. */
export const GET: APIRoute = (context) => handle(async () => ok(await getSession(requireCtx(context), context.params.id ?? '')));

/** `PATCH`: rename it. */
export const PATCH: APIRoute = (context) =>
  handle(async () => {
    const { title } = patch.parse(await readJson(context.request));
    await renameSession(requireCtx(context), context.params.id ?? '', title);
    return ok({ ok: true });
  });

/** `DELETE`: remove it and its turns. */
export const DELETE: APIRoute = (context) =>
  handle(async () => {
    await deleteSession(requireCtx(context), context.params.id ?? '');
    return ok({ ok: true });
  });
