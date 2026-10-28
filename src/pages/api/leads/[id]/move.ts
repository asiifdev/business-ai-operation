import type { APIRoute } from 'astro';
import { z } from 'zod';
import { moveLead } from '../../../../domain/pipeline/leads';
import { STAGES } from '../../../../domain/pipeline/stages';
import { handle, ok, param, readJson, requireCtx } from '../../../../lib/api';

export const prerender = false;

const body = z.object({ to: z.enum(STAGES), lostReason: z.string().max(500).optional() });

export const POST: APIRoute = (context) =>
  handle(async () => {
    const { to, lostReason } = body.parse(await readJson(context.request));
    await moveLead(requireCtx(context), param(context, 'id'), to, { lostReason });
    return ok({ id: param(context, 'id'), stage: to });
  });
