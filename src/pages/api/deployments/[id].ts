import type { APIRoute } from 'astro';
import { deleteDeployment, updateDeployment } from '../../../domain/portfolio/deployments';
import { handle, ok, param, readJson, requireCtx } from '../../../lib/api';

export const prerender = false;

export const PATCH: APIRoute = (context) =>
  handle(async () => {
    await updateDeployment(requireCtx(context), param(context, 'id'), (await readJson(context.request)) as never);
    return ok({ id: param(context, 'id') });
  });

export const DELETE: APIRoute = (context) =>
  handle(async () => {
    await deleteDeployment(requireCtx(context), param(context, 'id'));
    return ok({ id: param(context, 'id') });
  });
