import { useState } from 'react';
import { useT } from '../lib/use-t';
import { Button } from './ui/Button';
import { LocaleSwitch } from './ui/LocaleSwitch';
import { ThemeToggle } from './ui/ThemeToggle';

export type NavId = 'dashboard' | 'assistant' | 'ai';

interface Props {
  organizationName: string;
  userName: string;
  role: 'owner' | 'admin' | 'staff';
  /** The page being shown, so its link is marked as current. */
  current?: NavId;
}

const nav: Array<{ id: NavId; href: string; label: 'navDashboard' | 'navAssistant' | 'navAi' }> = [
  { id: 'dashboard', href: '/app', label: 'navDashboard' },
  { id: 'assistant', href: '/app/asisten', label: 'navAssistant' },
  { id: 'ai', href: '/app/ai', label: 'navAi' },
];

const roleKey = { owner: 'roleOwner', admin: 'roleAdmin', staff: 'roleStaff' } as const;

/** Top bar of the signed-in app: organization, language and theme switches, current user, sign-out. */
export function AppHeader({ organizationName, userName, role, current }: Props) {
  const t = useT();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    try {
      await fetch('/api/auth/sign-out', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', credentials: 'same-origin' });
    } finally {
      window.location.assign('/login');
    }
  }

  return (
    <header className="border-b border-rule bg-paper">
      <div className="wrap flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="m-0 truncate font-display text-base font-semibold text-ink">{organizationName}</p>
        <p className="m-0 truncate text-sm text-muted">
          {t('signedInAs')} {userName} · {t(roleKey[role])}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <LocaleSwitch />
        <ThemeToggle />
        <Button size="sm" onClick={signOut} loading={busy}>
          {t('signOut')}
        </Button>
      </div>
      </div>
      <nav aria-label={t('navLabel')} className="wrap -mb-px flex gap-1 overflow-x-auto">
        {nav.map((item) => (
          <a
            key={item.id}
            href={item.href}
            aria-current={current === item.id ? 'page' : undefined}
            className={
              'inline-flex min-h-11 items-center border-b-2 px-3 text-sm font-medium whitespace-nowrap transition-colors duration-(--duration-micro) ' +
              (current === item.id ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink')
            }
          >
            {t(item.label)}
          </a>
        ))}
      </nav>
    </header>
  );
}
