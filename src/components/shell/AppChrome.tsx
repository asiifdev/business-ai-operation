import { useEffect, useRef, useState } from 'react';
import type { Role } from '../../domain/permissions';
import { cx } from '../../lib/cx';
import { itemsFor, TAB_LIMIT, type NavId, type NavItem } from '../../lib/nav';
import { useT } from '../../lib/use-t';
import { LogoMark } from '../brand/LogoMark';
import { Button } from '../ui/Button';
import { LocaleSwitch } from '../ui/LocaleSwitch';
import { ThemeToggle } from '../ui/ThemeToggle';
import { Icon } from './Icon';
import { useSignOut } from './useSignOut';

export interface ChromeProps {
  organizationName: string;
  userName: string;
  role: Role;
  current?: NavId;
}

const roleKey = { owner: 'roleOwner', admin: 'roleAdmin', staff: 'roleStaff' } as const;

/**
 * The frame of every signed-in page. On a wide screen it is a sidebar. Under 64rem it becomes a phone app: a slim top
 * bar, a tab bar at the bottom, and a sheet for the rest (language, theme, sign out). Content sits beside or between them.
 */
export function AppChrome(props: ChromeProps) {
  return (
    <>
      <Sidebar {...props} />
      <PhoneChrome {...props} />
    </>
  );
}

function AccountBlock({ userName, role, stacked = false }: Pick<ChromeProps, 'userName' | 'role'> & { stacked?: boolean }) {
  const t = useT();
  const { signOut, busy } = useSignOut();
  return (
    <div className="flex flex-col gap-3">
      <div className="min-w-0">
        <p className="m-0 truncate text-sm font-medium text-ink">{userName}</p>
        <p className="m-0 truncate text-sm text-muted">{t(roleKey[role])}</p>
      </div>
      <div className={cx('flex items-center gap-2', stacked && 'justify-between')}>
        <LocaleSwitch />
        <ThemeToggle />
      </div>
      <Button size="sm" onClick={signOut} loading={busy} className="w-full">
        <Icon name="signout" className="size-4" />
        {t('signOut')}
      </Button>
    </div>
  );
}

function Sidebar({ organizationName, userName, role, current }: ChromeProps) {
  const t = useT();
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col gap-6 overflow-y-auto border-r border-rule bg-paper-2 px-3 py-5 lg:flex">
      <a href="/app" className="flex items-center gap-3 rounded-input px-2 py-1 text-ink no-underline">
        <LogoMark size={28} />
        <span className="min-w-0">
          <span className="block truncate font-display text-base font-semibold">{organizationName}</span>
        </span>
      </a>
      <nav aria-label={t('navLabel')} className="flex flex-1 flex-col gap-1">
        {itemsFor(role).map((item) => (
          <a
            key={item.id}
            href={item.href}
            aria-current={current === item.id ? 'page' : undefined}
            className={cx(
              'relative flex min-h-11 items-center gap-3 rounded-input px-3 text-base no-underline transition-colors duration-(--duration-micro)',
              current === item.id ? 'bg-paper-3 font-medium text-ink' : 'text-ink-2 hover:bg-paper-3 hover:text-ink',
            )}
          >
            {current === item.id && <span aria-hidden="true" className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-accent" />}
            <Icon name={item.icon} />
            {t(item.label)}
          </a>
        ))}
      </nav>
      <div className="border-t border-rule pt-4">
        <AccountBlock userName={userName} role={role} />
      </div>
    </aside>
  );
}

function PhoneChrome({ organizationName, userName, role, current }: ChromeProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const items = itemsFor(role);
  const tabs = items.slice(0, TAB_LIMIT);
  const initial = (userName.trim()[0] ?? '?').toUpperCase();

  return (
    <div className="lg:hidden">
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-rule bg-paper px-4 pt-[env(safe-area-inset-top)] [min-height:calc(3.5rem+env(safe-area-inset-top))]">
        <LogoMark size={26} />
        <p className="m-0 min-w-0 flex-1 truncate font-display text-base font-semibold text-ink">{organizationName}</p>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={t('accountMenu')}
          aria-haspopup="dialog"
          className="grid size-11 place-items-center rounded-full"
        >
          <span aria-hidden="true" className="grid size-8 place-items-center rounded-full bg-accent-wash font-display text-sm font-semibold text-ink">{initial}</span>
        </button>
      </header>

      <nav aria-label={t('navLabel')} className="fixed inset-x-0 bottom-0 z-30 border-t border-rule bg-paper pb-[env(safe-area-inset-bottom)]">
        <ul className="m-0 grid list-none p-0" style={{ gridTemplateColumns: `repeat(${tabs.length + 1}, minmax(0, 1fr))` }}>
          {tabs.map((item) => <TabLink key={item.id} item={item} active={current === item.id} />)}
          <li>
            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-haspopup="dialog"
              className="flex min-h-14 w-full flex-col items-center justify-center gap-0.5 text-xs font-medium text-muted"
            >
              <Icon name="more" />
              {t('navMore')}
            </button>
          </li>
        </ul>
      </nav>

      <Sheet open={open} onClose={() => setOpen(false)} title={t('accountMenu')}>
        <div className="flex flex-col gap-5">
          {items.length > TAB_LIMIT && (
            <ul className="m-0 flex list-none flex-col p-0">
              {items.slice(TAB_LIMIT).map((item) => (
                <li key={item.id}>
                  <a href={item.href} className="flex min-h-12 items-center gap-3 text-base text-ink no-underline"><Icon name={item.icon} />{t(item.label)}</a>
                </li>
              ))}
            </ul>
          )}
          <AccountBlock userName={userName} role={role} stacked />
        </div>
      </Sheet>
    </div>
  );
}

function TabLink({ item, active }: { item: NavItem; active: boolean }) {
  const t = useT();
  return (
    <li>
      <a
        href={item.href}
        aria-current={active ? 'page' : undefined}
        className={cx('relative flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs font-medium no-underline', active ? 'text-accent' : 'text-muted')}
      >
        {active && <span aria-hidden="true" className="absolute inset-x-6 top-0 h-0.5 rounded-full bg-accent" />}
        <Icon name={item.icon} />
        {t(item.label)}
      </a>
    </li>
  );
}

/** A panel that rises from the bottom edge. Closes on Escape, on the backdrop, and on the close button. */
function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  const t = useT();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40">
      <div aria-hidden="true" onClick={onClose} className="absolute inset-0 bg-ink/40" />
      <div role="dialog" aria-modal="true" aria-label={title} className="sheet absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-2xl border-t border-rule bg-paper px-4 pt-3 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
        <div className="mb-3 flex items-center justify-between">
          <span aria-hidden="true" className="mx-auto h-1 w-10 rounded-full bg-rule-2" />
        </div>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="m-0 text-lg font-semibold text-ink">{title}</h2>
          <button ref={closeRef} type="button" onClick={onClose} aria-label={t('closeMenu')} className="grid size-11 place-items-center rounded-full text-ink">
            <Icon name="close" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
