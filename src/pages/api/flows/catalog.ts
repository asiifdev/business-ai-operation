import type { APIRoute } from 'astro';
import { TOOLS } from '../../../domain/flows/tools';
import { describeFields } from '../../../domain/flows/tools/describe';
import { PRODUCT_FIELDS } from '../../../domain/flows/definition';
import { assertCan, can } from '../../../domain/permissions';
import { handle, ok, requireCtx } from '../../../lib/api';

export const prerender = false;

/** `GET /api/flows/catalog`: the tools a flow can be made of (BR-M17-17), for the editor's palette. */
export const GET: APIRoute = (context) =>
  handle(async () => {
    const ctx = requireCtx(context);
    assertCan(ctx, 'flow.read');
    return ok({
      tools: TOOLS.map((t) => ({ id: t.id, needs: t.needs, tier: t.tier, available: t.available, ownerOnly: Boolean(t.ownerOnly), outputs: t.outputs, fields: describeFields(t), secretKeys: t.secretKeys ?? [], producesSecretFrom: t.producesSecretFrom ?? null, creates: t.creates ?? null, deletes: t.deletes ?? null, allowed: !t.ownerOnly || can(ctx.role, 'flow.command') })),
      productFields: PRODUCT_FIELDS,
    });
  });
