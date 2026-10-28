import { AsyncLocalStorage } from 'node:async_hooks';
import { isLocale, setServerLocaleResolver, type Locale } from './i18n';

/** Server only. Keeps "which language is this request in" without passing it through every component. */
const store = new AsyncLocalStorage<Locale>();
setServerLocaleResolver(() => store.getStore());

export const runWithLocale = <T>(locale: Locale, fn: () => T): T => store.run(locale, fn);

/** Saved choice (cookie), then the person's profile language, then the browser's language, then Indonesian. */
export function pickLocale(input: { cookie?: string | null; profile?: string | null; acceptLanguage?: string | null }): Locale {
  if (isLocale(input.cookie)) return input.cookie;
  if (isLocale(input.profile)) return input.profile;
  const first = input.acceptLanguage?.split(',')[0]?.trim().toLowerCase();
  return first?.startsWith('en') ? 'en' : 'id';
}
