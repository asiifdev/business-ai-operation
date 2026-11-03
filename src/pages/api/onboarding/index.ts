import type { APIRoute } from 'astro';
import { getOnboarding } from '../../../domain/org/onboarding';
import { handle, ok, requireCtx } from '../../../lib/api';

export const prerender = false;

/** `GET /api/onboarding`: the state of every first-run step, read from real data (D-095). Owner and Admin. */
export const GET: APIRoute = (context) => handle(async () => ok(await getOnboarding(requireCtx(context))));
