import { useEffect, useState } from 'react';
import { Button } from '../ui/Button';

interface Props {
  lightLabel: string;
  darkLabel: string;
}

/** Light/dark switch for the public pages. Labels come from the page language, not from client storage. */
export function MarketingThemeToggle({ lightLabel, darkLabel }: Props) {
  const [dark, setDark] = useState(true);

  useEffect(() => {
    setDark(document.documentElement.dataset.theme === 'dark');
  }, []);

  const toggle = () => {
    const next = dark ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    setDark(!dark);
    try {
      localStorage.setItem('theme', next);
    } catch {
      /* blocked storage: the choice lasts for this page view */
    }
  };

  return (
    <Button size="sm" onClick={toggle} aria-pressed={dark} aria-label={dark ? lightLabel : darkLabel}>
      <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        {dark ? <path d="M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5z" /> : <><circle cx="8" cy="8" r="3" /><path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" /></>}
      </svg>
    </Button>
  );
}
