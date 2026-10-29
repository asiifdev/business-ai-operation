import type { APIRoute } from 'astro';
import { createUser, listUsers } from '../../../domain/users/service';
import { handle, ok, readJson, requireCtx } from '../../../lib/api';

export const prerender = false;

export const GET: APIRoute = (context) => handle(async () => ok({ users: await listUsers(requireCtx(context)) }));

/** `POST /api/users`: adds a colleague with an initial password they must change at first login. */
export const POST: APIRoute = (context) => handle(async () => ok(await createUser(requireCtx(context), (await readJson(context.request)) as never), 201));
