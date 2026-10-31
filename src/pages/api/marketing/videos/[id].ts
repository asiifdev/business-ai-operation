import type { APIRoute } from 'astro';
import { deleteVideo, getVideo } from '../../../../domain/marketing/video';
import { handle, ok, param, requireCtx } from '../../../../lib/api';

export const prerender = false;

export const GET: APIRoute = (context) => handle(async () => ok(await getVideo(requireCtx(context), param(context, 'id'))));

export const DELETE: APIRoute = (context) =>
  handle(async () => {
    await deleteVideo(requireCtx(context), param(context, 'id'));
    return ok({ id: param(context, 'id') });
  });
