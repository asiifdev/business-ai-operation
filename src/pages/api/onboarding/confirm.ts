import type { APIRoute } from 'astro';
import { confirmOnboardingStep } from '../../../domain/org/onboarding';
import { handle, ok, readJson, requireCtx } from '../../../lib/api';

export const prerender = false;

/** `POST /api/onboarding/confirm` `{ step: 'assistant' }`: Owner only. */
export const POST: APIRoute = (context) =>
  handle(async () => {
    await confirmOnboardingStep(requireCtx(context), await readJson(context.request));
    return ok({ confirmed: true });
  });
