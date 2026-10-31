import type { APIRoute } from 'astro';
import { DomainError } from '../../../../domain/errors';
import { MAX_LOGO_BYTES, readBrandLogo, removeBrandLogo, setBrandLogo } from '../../../../domain/portfolio/logo';
import { handle, ok, rateLimit, requireCtx } from '../../../../lib/api';

export const prerender = false;

/** The company logo picture (D-066, moved to the company profile by D-079). */
export const GET: APIRoute = (context) =>
  handle(async () => {
    const logo = await readBrandLogo(requireCtx(context));
    return new Response(Buffer.from(logo.bytes), { headers: { 'content-type': logo.mime, 'cache-control': 'private, max-age=60', 'x-content-type-options': 'nosniff' } });
  });

/** `POST` multipart with a `file` field. Owner and Admin only. */
export const POST: APIRoute = (context) =>
  handle(async () => {
    const ctx = requireCtx(context);
    const limited = rateLimit(ctx, 'brand-logo', 10, 60_000);
    if (limited) return limited;
    if (Number(context.request.headers.get('content-length') ?? 0) > MAX_LOGO_BYTES + 64 * 1024) throw new DomainError('validation', 'logo:size');
    const file = (await context.request.formData().catch(() => null))?.get('file');
    if (!(file instanceof File)) throw new DomainError('validation', 'file');
    await setBrandLogo(ctx, new Uint8Array(await file.arrayBuffer()));
    return ok({ saved: true });
  });

export const DELETE: APIRoute = (context) =>
  handle(async () => {
    await removeBrandLogo(requireCtx(context));
    return ok({ removed: true });
  });
