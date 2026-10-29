import type { APIRoute } from 'astro';
import { listTemplates } from '../../../../domain/flows/service';
import { assertCan } from '../../../../domain/permissions';
import { handle, ok, requireCtx } from '../../../../lib/api';

export const prerender = false;

export const GET: APIRoute = (context) =>
  handle(async () => {
    assertCan(requireCtx(context), 'flow.read');
    return ok({ templates: listTemplates() });
  });
