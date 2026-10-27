/**
 * Consent for Google Analytics 4 (D-031, BR-M16-30/31). Written without a framework so it can be tested:
 * nothing is requested from Google until the visitor accepts, and a later decline clears the cookies again.
 */
export const CONSENT_KEY = 'orbyte_consent';
export type ConsentChoice = 'granted' | 'denied';

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface ConsentDeps {
  storage: StorageLike | null;
  measurementId: string | undefined;
  /** Loads a script by URL (injected so tests can observe it). */
  loadScript: (src: string) => void;
  /** Receives gtag() arguments (the dataLayer push). */
  gtag: (...args: unknown[]) => void;
  clearCookies: () => void;
}

export function readChoice(storage: StorageLike | null): ConsentChoice | null {
  try {
    const v = storage?.getItem(CONSENT_KEY);
    return v === 'granted' || v === 'denied' ? v : null;
  } catch {
    return null;
  }
}

export function createConsent(deps: ConsentDeps) {
  let loaded = false;

  const defaultDenied = () =>
    deps.gtag('consent', 'default', { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied' });

  function grantNow() {
    if (!deps.measurementId) return;
    deps.gtag('consent', 'update', { analytics_storage: 'granted' });
    if (!loaded) {
      loaded = true;
      deps.loadScript(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(deps.measurementId)}`);
      deps.gtag('js', new Date());
      deps.gtag('config', deps.measurementId, { allow_google_signals: false, allow_ad_personalization_signals: false });
    }
  }

  return {
    /** Called on every page load. Sets the denied default first; loads Google only if consent was granted before. */
    init(): ConsentChoice | null {
      defaultDenied();
      const choice = readChoice(deps.storage);
      if (choice === 'granted') grantNow();
      return choice;
    },
    accept() {
      try {
        deps.storage?.setItem(CONSENT_KEY, 'granted');
      } catch {
        /* Storage blocked: consent lasts for this page view only. */
      }
      grantNow();
    },
    decline() {
      try {
        deps.storage?.setItem(CONSENT_KEY, 'denied');
      } catch {
        /* see accept() */
      }
      if (loaded) {
        deps.gtag('consent', 'update', { analytics_storage: 'denied' });
        deps.clearCookies();
      }
    },
    /** Sends a call-to-action click, only while consent is granted. */
    track(event: string, params: Record<string, string>) {
      if (readChoice(deps.storage) === 'granted' && loaded) deps.gtag('event', event, params);
    },
  };
}
