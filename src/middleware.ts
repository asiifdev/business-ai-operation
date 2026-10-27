import { defineMiddleware } from 'astro:middleware';
import { resolveSession } from './auth/session';

/** Paths that never need a session. Everything else under /app and /api requires one. */
const PUBLIC_API = [/^\/api\/auth(\/|$)/, /^\/api\/register$/, /^\/api\/health$/, /^\/api\/telegram\/webhook$/];
const isAsset = (p: string) => p.startsWith('/_astro/') || /\.[a-z0-9]{2,5}$/i.test(p);

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;
  context.locals.user = null;
  context.locals.ctx = null;
  context.locals.organizationName = null;
  if (isAsset(pathname)) return next();

  const resolved = await resolveSession(context.request.headers);
  if (resolved) {
    context.locals.user = resolved.user;
    context.locals.ctx = resolved.ctx;
    context.locals.organizationName = resolved.organizationName;
  }

  if (pathname.startsWith('/app') && !resolved) return context.redirect('/login');
  if (pathname.startsWith('/api/') && !resolved && !PUBLIC_API.some((re) => re.test(pathname))) {
    return Response.json({ ok: false, error: { code: 'unauthorized', message: 'Sign in required' } }, { status: 401 });
  }
  if (resolved && (pathname === '/login' || pathname === '/register')) return context.redirect('/app');
  return next();
});
