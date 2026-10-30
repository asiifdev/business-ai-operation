import { defineMiddleware } from 'astro:middleware';
import { resolveSession } from './auth/session';
import { LOCALE_COOKIE } from './lib/i18n';
import { ensureTicker } from './server/ticker';
import { startJobs } from './server/jobs';
import { pickLocale, runWithLocale } from './lib/locale-server';
import { saveOwnLocale } from './domain/users/profile';
import { isLocale } from './lib/i18n';

/** Paths that never need a session. Everything else under /app and /api requires one. */
const PUBLIC_API = [/^\/api\/auth(\/|$)/, /^\/api\/register$/, /^\/api\/health$/, /^\/api\/telegram\/webhook$/, /^\/api\/github\/webhook$/];
const isAsset = (p: string) => p.startsWith('/_astro/') || /\.[a-z0-9]{2,5}$/i.test(p);

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;
  context.locals.user = null;
  context.locals.ctx = null;
  context.locals.organizationName = null;
  context.locals.timezone = 'Asia/Jakarta';
  context.locals.locale = 'id';
  // Public marketing pages are rendered at build time: no session lookup, no database, no request headers.
  if (context.isPrerendered || isAsset(pathname)) return next();
  // The scheduler starts with the first real request, never during the build (which renders the public pages).
  ensureTicker();
  startJobs();

  const resolved = await resolveSession(context.request.headers);
  if (resolved) {
    context.locals.user = resolved.user;
    context.locals.ctx = resolved.ctx;
    context.locals.organizationName = resolved.organizationName;
    context.locals.timezone = resolved.timezone;
  }

  if (pathname.startsWith('/app') && !resolved) return context.redirect('/login');
  if (pathname.startsWith('/api/') && !resolved && !PUBLIC_API.some((re) => re.test(pathname))) {
    return Response.json({ ok: false, error: { code: 'unauthorized', message: 'Sign in required' } }, { status: 401 });
  }
  // A temporary password must be replaced first: until then only the profile page, its endpoint and sign-out are open.
  if (resolved?.user.mustChangePassword) {
    const open = pathname === '/app/settings/profil' || pathname === '/api/profile/password' || PUBLIC_API.some((re) => re.test(pathname));
    if (pathname.startsWith('/app') && !open) return context.redirect('/app/settings/profil');
    if (pathname.startsWith('/api/') && !open) return Response.json({ ok: false, error: { code: 'forbidden', message: 'Change your password first' } }, { status: 403 });
  }
  if (resolved && (pathname === '/login' || pathname === '/register')) return context.redirect('/app');

  const locale = pickLocale({
    cookie: context.cookies.get(LOCALE_COOKIE)?.value,
    profile: resolved?.user.locale,
    acceptLanguage: context.request.headers.get('accept-language'),
  });
  context.locals.locale = locale;
  // A language chosen with the switch lives in a cookie; the account keeps it too, so Telegram and other devices speak the same one.
  const chosen = context.cookies.get(LOCALE_COOKIE)?.value;
  if (resolved && isLocale(chosen) && chosen !== resolved.user.locale) void saveOwnLocale(resolved.ctx, chosen).catch(() => undefined);
  // React renders the page's islands while the response body is read, so read it all inside the language scope.
  // Otherwise two requests in different languages could end up rendering with each other's.
  return runWithLocale(locale, async () => {
    const response = await next();
    if (!response.headers.get('content-type')?.includes('text/html')) return response;
    return new Response(await response.text(), { status: response.status, statusText: response.statusText, headers: response.headers });
  });
});
