import { useCallback, useSyncExternalStore } from 'react';
import { getLocale, getServerLocale, subscribeLocale, translate, type Locale, type MessageKey } from './i18n';

/** Subscribes the calling component to locale changes. During hydration it returns the server's language, then updates. */
export function useLocale(): Locale {
  return useSyncExternalStore(subscribeLocale, getLocale, getServerLocale);
}

/** Returns a `t` bound to the language React is rendering with, so server and first client render always match. */
export function useT() {
  const locale = useLocale();
  return useCallback((key: MessageKey, vars?: Record<string, string | number>) => translate(locale, key, vars), [locale]);
}
