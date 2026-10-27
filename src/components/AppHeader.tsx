import { useState } from 'react';
import { useT } from '../lib/use-t';
import { Button } from './ui/Button';
import { LocaleSwitch } from './ui/LocaleSwitch';
import { ThemeToggle } from './ui/ThemeToggle';

interface Props {
  organizationName: string;
  userName: string;
  role: 'owner' | 'admin' | 'staff';
}

const roleKey = { owner: 'roleOwner', admin: 'roleAdmin', staff: 'roleStaff' } as const;

/** Top bar of the signed-in app: organization, language and theme switches, current user, sign-out. */
export function AppHeader({ organizationName, userName, role }: Props) {
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
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-rule bg-paper px-4 py-3 sm:px-6">
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
    </header>
  );
}
