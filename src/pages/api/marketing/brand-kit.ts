import type { APIRoute } from 'astro';
import { getBrandKit, saveBrandKit } from '../../../domain/marketing/service';
import { handle, ok, readJson, requireCtx } from '../../../lib/api';

export const prerender = false;

export const GET: APIRoute = (context) => handle(async () => ok(await getBrandKit(requireCtx(context))));

/** `PUT /api/marketing/brand-kit`: Owner and Admin only (BR-M10-11). */
export const PUT: APIRoute = (context) => handle(async () => ok(await saveBrandKit(requireCtx(context), (await readJson(context.request)) as never)));
