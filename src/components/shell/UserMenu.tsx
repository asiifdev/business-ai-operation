import { useEffect, useRef, useState } from 'react';
import type { Role } from '../../domain/permissions';
import { cx } from '../../lib/cx';
import { useT } from '../../lib/use-t';
import { LocaleSwitch } from '../ui/LocaleSwitch';
import { ThemeToggle } from '../ui/ThemeToggle';
import { Icon } from './Icon';
import { useSignOut } from './useSignOut';

const roleKey = { owner: 'roleOwner', admin: 'roleAdmin', staff: 'roleStaff' } as const;

/** Round initial of a person's name. Decorative: the name next to it carries the meaning. */
export function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' }) {
  const initial = (name.trim()[0] ?? '?').toUpperCase();
  return (
    <span aria-hidden="true" className={cx('grid shrink-0 place-items-center rounded-full bg-accent font-display font-semibold text-accent-ink', size === 'sm' ? 'size-7 text-xs' : 'size-9 text-sm')}>
      {initial}
    </span>
  );
}

/** The signed-in person's card at the foot of the sidebar. It opens a small menu upward with language, theme and sign out. */
export function UserMenu({ userName, role }: { userName: string; role: Role }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const { signOut, busy } = useSignOut();
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      {open && (
        <div role="dialog" aria-label={t('accountMenuOpen')} className="pop absolute inset-x-0 bottom-full mb-2 flex flex-col gap-3 rounded-card border border-rule bg-key-face p-3 shadow-pop">
          <div className="flex items-center justify-between gap-2">
            <LocaleSwitch />
            <ThemeToggle />
          </div>
          <button type="button" onClick={signOut} disabled={busy} className="flex min-h-10 items-center gap-2 rounded-input px-2 text-base text-ink hover:bg-paper-2 disabled:opacity-50">
            <Icon name="signout" className="size-4" />
            {t('signOut')}
          </button>
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={t('accountMenuOpen')}
        className="flex w-full items-center gap-3 rounded-card p-2 text-left transition-colors hover:bg-paper-3"
      >
        <Avatar name={userName} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-ink">{userName}</span>
          <span className="block truncate text-xs text-muted">{t(roleKey[role])}</span>
        </span>
        <Icon name="chevron" className={cx('size-4 shrink-0 text-muted transition-transform', !open && 'rotate-180')} />
      </button>
    </div>
  );
}
