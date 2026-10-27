import { useEffect, useRef, useState } from 'react';
import { Button } from '../ui/Button';
import { createConsent, type ConsentChoice } from '../../lib/consent';

interface Labels {
  title: string;
  body: string;
  accept: string;
  decline: string;
  more: string;
}

interface Props {
  /** GA4 measurement id. Without it there is no analytics at all, so no banner. */
  measurementId?: string;
  labels: Labels;
  privacyHref: string;
}

declare global {
  interface Window {
    dataLayer?: unknown[];
  }
}

function clearGaCookies() {
  const host = location.hostname.split('.');
  const domains = [location.hostname, ...host.map((_, i) => `.${host.slice(i).join('.')}`).filter((d) => d.includes('.') && d.split('.').length > 2)];
  for (const cookie of document.cookie.split(';')) {
    const name = cookie.split('=')[0].trim();
    if (name === '_ga' || name.startsWith('_ga_')) {
      for (const d of [undefined, ...domains]) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/${d ? `; domain=${d}` : ''}`;
    }
  }
}

/**
 * Cookie banner and Google Analytics loader (D-031). Equal Accept and Decline buttons; nothing is requested
 * from Google before Accept. Click tracking only covers links marked data-cta, only after consent.
 */
export function ConsentManager({ measurementId, labels, privacyHref }: Props) {
  const [choice, setChoice] = useState<ConsentChoice | null>(null);
  const [open, setOpen] = useState(false);
  const api = useRef<ReturnType<typeof createConsent> | null>(null);

  useEffect(() => {
    if (!measurementId) return;
    window.dataLayer = window.dataLayer || [];
    let storage: Storage | null = null;
    try {
      storage = window.localStorage;
    } catch {
      storage = null;
    }
    api.current = createConsent({
      storage,
      measurementId,
      gtag: (...args) => {
        // gtag.js expects the real `arguments` object pushed onto dataLayer.
        (window.dataLayer as unknown[]).push(args as unknown as IArguments);
      },
      loadScript: (src) => {
        const s = document.createElement('script');
        s.async = true;
        s.src = src;
        document.head.appendChild(s);
      },
      clearCookies: clearGaCookies,
    });
    const initial = api.current.init();
    setChoice(initial);
    setOpen(initial === null);

    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.('a[data-cta]') as HTMLAnchorElement | null;
      if (!a) return;
      const cta = a.dataset.cta ?? 'unknown';
      api.current?.track('cta_click', { cta, page: location.pathname });
      if (cta === 'register') api.current?.track('signup_start', { page: location.pathname });
    };
    const reopen = (e: Event) => {
      if ((e.target as Element | null)?.closest?.('[data-consent-open]')) setOpen(true);
    };
    document.addEventListener('click', onClick);
    document.addEventListener('click', reopen);
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('click', reopen);
    };
  }, [measurementId]);

  if (!measurementId || !open) return null;

  const decide = (next: ConsentChoice) => {
    if (next === 'granted') api.current?.accept();
    else api.current?.decline();
    setChoice(next);
    setOpen(false);
  };

  return (
    <section aria-label={labels.title} className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-xl rounded-card border border-rule-2 bg-paper p-4 shadow-pop sm:inset-x-6">
      <h2 className="m-0 font-display text-base font-semibold text-ink">{labels.title}</h2>
      <p className="mt-1 mb-3 text-sm text-ink-2" data-choice={choice ?? 'none'}>
        {labels.body} <a href={privacyHref} className="text-accent underline underline-offset-4">{labels.more}</a>
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={() => decide('granted')}>{labels.accept}</Button>
        <Button variant="secondary" size="sm" onClick={() => decide('denied')}>{labels.decline}</Button>
      </div>
    </section>
  );
}
