import type { APIRoute } from 'astro';
import { listVideos } from '../../../../domain/marketing/video';
import { handle, ok, requireCtx } from '../../../../lib/api';

export const prerender = false;

/** `GET /api/marketing/videos`: saved scripts and their videos, newest first, with the status of each (D-086). */
export const GET: APIRoute = (context) => handle(async () => ok({ videos: await listVideos(requireCtx(context)) }));
