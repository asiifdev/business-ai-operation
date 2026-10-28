import type { APIContext } from 'astro';
import { ZodError } from 'zod';
import type { Ctx } from '../domain/ctx';
import { DomainError, HTTP_STATUS } from '../domain/errors';
import { limiter } from './rate-limit';

export const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export const ok = (data: unknown, status = 200) => json({ ok: true, data }, status);

const fail = (code: string, message: string, status: number, extra: Record<string, unknown> = {}) => json({ ok: false, error: { code, message, ...extra } }, status);

/** The signed-in person's context. The middleware already answered 401 for anyone else, so a miss here is a bug. */
export function requireCtx(context: Pick<APIContext, 'locals'>): Ctx {
  const ctx = context.locals.ctx;
  if (!ctx) throw new DomainError('forbidden', 'no session');
  return ctx;
}

/** Slows one user down per action (BR-M01 abuse limits). Returns a 429 response when the limit is hit. */
export function rateLimit(ctx: Ctx, action: string, max: number, windowMs: number): Response | null {
  return limiter.allow(`${action}:${ctx.userId}`, max, windowMs) ? null : fail('rate_limited', 'Too many requests', HTTP_STATUS.rate_limited);
}

export async function readJson(request: Request): Promise<unknown> {
  if (!request.headers.get('content-type')?.includes('application/json')) throw new DomainError('validation', 'JSON required');
  try {
    return await request.json();
  } catch {
    throw new DomainError('validation', 'Invalid JSON');
  }
}

/**
 * One place that turns thrown errors into the API's error shape: validation problems are 400 with the field names (never
 * the values), business rules map through `HTTP_STATUS`, and anything unexpected is logged and answered with a bare 500.
 */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ZodError) return fail('validation', 'Invalid input', 400, { fields: error.issues.map((i) => i.path.join('.')) });
    if (error instanceof DomainError) return fail(error.code, error.code, HTTP_STATUS[error.code]);
    console.error('api error', error);
    return fail('internal', 'Unexpected error', 500);
  }
}
