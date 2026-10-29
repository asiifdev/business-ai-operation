import type { APIRoute } from 'astro';
import { DomainError } from '../../../../domain/errors';
import { MAX_LOGO_BYTES, readProductLogo, removeProductLogo, setProductLogo } from '../../../../domain/portfolio/logo';
import { handle, ok, param, rateLimit, requireCtx } from '../../../../lib/api';

export const prerender = false;

/** The picture itself. A short cache is fine: the address changes only through this route. */
export const GET: APIRoute = (context) =>
  handle(async () => {
    const logo = await readProductLogo(requireCtx(context), param(context, 'id'));
    return new Response(Buffer.from(logo.bytes), { headers: { 'content-type': logo.mime, 'cache-control': 'private, max-age=60', 'x-content-type-options': 'nosniff' } });
  });

/** `POST` multipart with a `file` field: sets or replaces the logo. */
export const POST: APIRoute = (context) =>
  handle(async () => {
    const ctx = requireCtx(context);
    const limited = rateLimit(ctx, 'product-logo', 10, 60_000);
    if (limited) return limited;
    const declared = Number(context.request.headers.get('content-length') ?? 0);
    if (declared > MAX_LOGO_BYTES + 64 * 1024) throw new DomainError('validation', 'logo:size');
    const form = await context.request.formData().catch(() => null);
    const file = form?.get('file');
    if (!(file instanceof File)) throw new DomainError('validation', 'file');
    await setProductLogo(ctx, param(context, 'id'), new Uint8Array(await file.arrayBuffer()));
    return ok({ id: param(context, 'id') });
  });

export const DELETE: APIRoute = (context) =>
  handle(async () => {
    await removeProductLogo(requireCtx(context), param(context, 'id'));
    return ok({ id: param(context, 'id') });
  });
