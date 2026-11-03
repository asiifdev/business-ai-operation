import type { APIRoute } from 'astro';
import { completeOnboarding } from '../../../domain/org/onboarding';
import { handle, ok, requireCtx } from '../../../lib/api';

export const prerender = false;

/** `POST /api/onboarding/complete`: the Owner closes the wizard. Idempotent. */
export const POST: APIRoute = (context) => handle(async () => ok(await completeOnboarding(requireCtx(context))));
