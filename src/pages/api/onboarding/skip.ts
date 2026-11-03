import type { APIRoute } from 'astro';
import { skipOnboardingStep } from '../../../domain/org/onboarding';
import { handle, ok, readJson, requireCtx } from '../../../lib/api';

export const prerender = false;

/** `POST /api/onboarding/skip` `{ step }`: sets a step aside until the person comes back to it. */
export const POST: APIRoute = (context) =>
  handle(async () => {
    await skipOnboardingStep(requireCtx(context), await readJson(context.request));
    return ok({ skipped: true });
  });
