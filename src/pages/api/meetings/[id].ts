import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getMeeting, setSpeakerMap, speakerMapSchema } from '../../../domain/meetings/service';
import { handle, ok, param, readJson, requireCtx } from '../../../lib/api';

export const prerender = false;

export const GET: APIRoute = (context) => handle(async () => ok(await getMeeting(requireCtx(context), param(context, 'id'))));

const body = z.object({ speakerMap: speakerMapSchema });

/** `PATCH`: names for the speaker labels (BR-M09-12). */
export const PATCH: APIRoute = (context) =>
  handle(async () => {
    const { speakerMap } = body.parse(await readJson(context.request));
    await setSpeakerMap(requireCtx(context), param(context, 'id'), speakerMap);
    return ok({ id: param(context, 'id') });
  });
