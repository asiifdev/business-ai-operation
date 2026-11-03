import type { APIRoute } from 'astro';
import { ZodError } from 'zod';
import { auth } from '../../../auth/auth';
import { DomainError, HTTP_STATUS } from '../../../domain/errors';
import { acceptInvitation } from '../../../domain/users/invitations';
import { limiter } from '../../../lib/rate-limit';

export const prerender = false;

const json = (body: unknown, status: number, headers?: Headers) => {
  const h = new Headers(headers);
  h.set('content-type', 'application/json');
  return new Response(JSON.stringify(body), { status, headers: h });
};

/** Public: the invited person sets name and password with the one-time token, and is signed in. Like registration, limited per address. */
export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (!request.headers.get('content-type')?.includes('application/json')) return json({ ok: false, error: { code: 'validation', message: 'JSON required' } }, 415);
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || clientAddress || 'unknown';
  if (!limiter.allow(`invite-accept:${ip}`, 10, 60 * 60 * 1000)) return json({ ok: false, error: { code: 'rate_limited', message: 'Too many attempts' } }, HTTP_STATUS.rate_limited);
  let body: { token?: unknown; name?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: { code: 'validation', message: 'Invalid JSON' } }, 400);
  }
  try {
    const created = await acceptInvitation(body);
    const signIn = await auth.api.signInEmail({ body: { email: created.email, password: String(body.password) }, asResponse: true });
    const headers = new Headers();
    for (const cookie of signIn.headers.getSetCookie()) headers.append('set-cookie', cookie);
    return json({ ok: true, data: { orgId: created.orgId } }, 201, headers);
  } catch (err) {
    if (err instanceof ZodError) return json({ ok: false, error: { code: 'validation', message: 'Invalid input', fields: err.issues.map((i) => i.path.join('.')) } }, 400);
    if (err instanceof DomainError) return json({ ok: false, error: { code: err.code, message: err.code } }, HTTP_STATUS[err.code]);
    console.error('accept invitation failed', err);
    return json({ ok: false, error: { code: 'internal', message: 'Unexpected error' } }, 500);
  }
};
