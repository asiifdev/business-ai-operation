import { useEffect, useState } from 'react';
import { useT } from '../../lib/use-t';
import { Button } from './Button';

type Theme = 'light' | 'dark';

export function ThemeToggle() {
  const t = useT();
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  }, []);

  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    setTheme(next);
    try {
      localStorage.setItem('theme', next);
    } catch {
      /* Storage can be blocked; the choice then lasts for this page view only. */
    }
  };

  return (
    <Button size="sm" onClick={toggle} aria-label={theme === 'dark' ? t('themeLight') : t('themeDark')} aria-pressed={theme === 'dark'}>
      <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        {theme === 'dark' ? <path d="M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5z" /> : <><circle cx="8" cy="8" r="3" /><path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" /></>}
      </svg>
    </Button>
  );
}
