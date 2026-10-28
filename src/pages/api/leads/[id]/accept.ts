import type { APIRoute } from 'astro';
import { acceptLeadDraft } from '../../../../domain/pipeline/leads';
import { handle, ok, param, requireCtx } from '../../../../lib/api';

export const prerender = false;

/** A person accepts a lead an AI proposed; only then does it count in the pipeline (BR-M04-06). */
export const POST: APIRoute = (context) =>
  handle(async () => {
    await acceptLeadDraft(requireCtx(context), param(context, 'id'));
    return ok({ id: param(context, 'id') });
  });
