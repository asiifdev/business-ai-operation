import type { APIRoute } from 'astro';
import { checkDefinition } from '../../../domain/flows/service';
import { validateDefinition } from '../../../domain/flows/definition';
import { assertCan, can } from '../../../domain/permissions';
import { handle, ok, readJson, requireCtx } from '../../../lib/api';

export const prerender = false;

/** `POST /api/flows/validate`: every problem of a definition, for the editor. Saves nothing. */
export const POST: APIRoute = (context) =>
  handle(async () => {
    const ctx = requireCtx(context);
    assertCan(ctx, 'flow.read');
    const body = (await readJson(context.request)) as { definition?: unknown };
    const r = checkDefinition(body.definition, can(ctx.role, 'flow.command'));
    return ok({ ok: r.ok, problems: r.problems, order: r.definition ? validateDefinition(r.definition, { canUseCommand: true }).order : null });
  });
