import type { APIRoute } from 'astro';
import { getCompanyProfile, saveCompanyProfile } from '../../../../domain/org/profile';
import { handle, ok, readJson, requireCtx } from '../../../../lib/api';

export const prerender = false;

/** `GET /api/settings/company`: the company profile and its services. Everyone in the organization may read it (D-079). */
export const GET: APIRoute = (context) => handle(async () => ok(await getCompanyProfile(requireCtx(context))));

/** `POST /api/settings/company`: Owner and Admin. Answers with the fields that changed (empty when nothing did). */
export const POST: APIRoute = (context) => handle(async () => ok(await saveCompanyProfile(requireCtx(context), (await readJson(context.request)) as never)));
