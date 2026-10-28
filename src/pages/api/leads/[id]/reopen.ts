import type { APIRoute } from 'astro';
import { z } from 'zod';
import { reopenLead } from '../../../../domain/pipeline/leads';
import { OPEN_STAGES } from '../../../../domain/pipeline/stages';
import { handle, ok, param, readJson, requireCtx } from '../../../../lib/api';

export const prerender = false;

const body = z.object({ note: z.string().max(500), to: z.enum(OPEN_STAGES).optional() });

export const POST: APIRoute = (context) =>
  handle(async () => {
    await reopenLead(requireCtx(context), param(context, 'id'), body.parse(await readJson(context.request)));
    return ok({ id: param(context, 'id') });
  });
