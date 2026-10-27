import { useEffect, useState } from 'react';
import { buttonClasses } from '../ui/Button';

interface Props {
  signInLabel: string;
  getStartedLabel: string;
  openAppLabel: string;
}

/** Shows "Sign in / Get started", or "Open app" when a session exists. Static pages cannot know this at build time. */
export function AccountLink({ signInLabel, getStartedLabel, openAppLabel }: Props) {
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/get-session', { credentials: 'same-origin', headers: { accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data?.user) setSignedIn(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (signedIn) {
    return <a href="/app" data-cta="open-app" className={buttonClasses('primary', 'sm', undefined, 'pill')}>{openAppLabel}</a>;
  }
  return (
    <>
      <a href="/login" className="px-2 text-sm text-ink-2 underline-offset-4 hover:text-ink hover:underline">{signInLabel}</a>
      <a href="/register" data-cta="register" className={buttonClasses('primary', 'sm', undefined, 'pill')}>{getStartedLabel}</a>
    </>
  );
}
