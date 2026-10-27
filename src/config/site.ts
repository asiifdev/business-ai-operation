import { brand } from './brand';

/** Public-site settings. Everything environment-specific comes from variables; nothing is committed (BR-M16-30). */
const read = (name: string): string | undefined => {
  const v = (import.meta.env as Record<string, string | undefined>)[name] ?? process.env[name];
  return v && v.trim() ? v.trim() : undefined;
};

export const locales = ['en', 'id'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'en';

export const site = {
  /** Canonical origin, no trailing slash. */
  url: (read('APP_URL') ?? 'http://localhost:4321').replace(/\/$/, ''),
  contactEmail: read('SITE_CONTACT_EMAIL') ?? brand.contactEmail,
  /** GA4 measurement id (G-XXXX). The script is only ever loaded after consent. */
  gaMeasurementId: read('PUBLIC_GA_MEASUREMENT_ID'),
  googleSiteVerification: read('PUBLIC_GOOGLE_SITE_VERIFICATION'),
  bingSiteVerification: read('PUBLIC_BING_SITE_VERIFICATION'),
  turnstileSiteKey: read('PUBLIC_TURNSTILE_SITE_KEY'),
  /** Public demo video, when it exists. The /demo page is not published without it. */
  demoVideoUrl: read('PUBLIC_DEMO_VIDEO_URL'),
};

/** Absolute URL for a locale-aware path. EN lives at the root, ID under /id. */
export function pageUrl(locale: Locale, slug: string): string {
  const path = slug === '' ? '' : `/${slug}`;
  return `${site.url}${locale === defaultLocale ? '' : '/id'}${path}` + (slug === '' && locale === defaultLocale ? '/' : '');
}
export function pagePath(locale: Locale, slug: string): string {
  const base = locale === defaultLocale ? '' : '/id';
  return slug === '' ? (base === '' ? '/' : base) : `${base}/${slug}`;
}
