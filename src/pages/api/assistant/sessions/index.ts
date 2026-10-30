import type { APIRoute } from 'astro';
import { listSessions } from '../../../../domain/assistant/sessions';
import { handle, ok, requireCtx } from '../../../../lib/api';

export const prerender = false;

/** `GET /api/assistant/sessions?q=`: the caller's own conversations with the assistant, newest first. */
export const GET: APIRoute = (context) =>
  handle(async () => ok({ sessions: await listSessions(requireCtx(context), { q: context.url.searchParams.get('q') ?? undefined }) }));
