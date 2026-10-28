import { useEffect, useRef, useState } from 'react';
import type { AttentionCounts } from '../../domain/dashboard/overview';
import type { Role } from '../../domain/permissions';
import { formatFullDate } from '../../lib/format';
import { BILLING_PAGES_READY } from '../../lib/nav';
import { cx } from '../../lib/cx';
import { GROUP_LABEL, groupedFor, itemsFor, TAB_LIMIT, type NavId, type NavItem } from '../../lib/nav';
import { useT } from '../../lib/use-t';
import { LogoMark } from '../brand/LogoMark';
import { Button, buttonClasses } from '../ui/Button';
import { LocaleSwitch } from '../ui/LocaleSwitch';
import { ThemeToggle } from '../ui/ThemeToggle';
import { CommandPalette } from './CommandPalette';
import { Icon } from './Icon';
import { CountPill } from '../dashboard/primitives';
import { Avatar, UserMenu } from './UserMenu';
import { useSignOut } from './useSignOut';

export interface ChromeProps {
  organizationName: string;
  userName: string;
  role: Role;
  current?: NavId;
  /** The organization's today (ISO date), shown under the page title. */
  today: string;
  /** What needs a person's attention, for the sidebar pills and the bell. */
  counts: AttentionCounts;
}

const roleKey = { owner: 'roleOwner', admin: 'roleAdmin', staff: 'roleStaff' } as const;

/**
 * The frame of every signed-in page. On a wide screen it is a sidebar plus a slim top bar with the ⌘K search. Under 64rem
 * it becomes a phone app: a top bar, a tab bar at the bottom, and a sheet for the rest (language, theme, sign out).
 */
export function AppChrome(props: ChromeProps) {
  const [palette, setPalette] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette((v) => !v);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  const openPalette = () => setPalette(true);
  return (
    <>
      <Sidebar {...props} />
      <TopBar onSearch={openPalette} role={props.role} current={props.current} today={props.today} counts={props.counts} />
      <PhoneChrome {...props} onSearch={openPalette} />
      <CommandPalette open={palette} onClose={() => setPalette(false)} role={props.role} />
    </>
  );
}

function AccountBlock({ userName, role, stacked = false }: Pick<ChromeProps, 'userName' | 'role'> & { stacked?: boolean }) {
  const t = useT();
  const { signOut, busy } = useSignOut();
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <Avatar name={userName} />
        <div className="min-w-0">
          <p className="m-0 truncate text-sm font-medium text-ink">{userName}</p>
          <p className="m-0 truncate text-sm text-muted">{t(roleKey[role])}</p>
        </div>
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

/** The search pill. It looks like a field but opens the palette, so there is one place to search from everywhere. */
function SearchTrigger({ onSearch, className }: { onSearch: () => void; className?: string }) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={onSearch}
      aria-label={t('searchPlaceholder')}
      aria-keyshortcuts="Control+K Meta+K"
      className={cx('group flex h-9 items-center gap-2 rounded-input border border-rule bg-key-face px-3 text-sm text-muted shadow-btn transition-colors hover:border-rule-2 hover:text-ink', className)}
    >
      <Icon name="search" className="size-4" />
      <span className="flex-1 truncate text-left">{t('searchShort')}</span>
      <kbd className="hidden rounded border border-rule bg-paper-2 px-1.5 font-mono text-xs text-muted sm:inline">⌘K</kbd>
    </button>
  );
}

function TopBar({ onSearch, role, current, today, counts }: { onSearch: () => void } & Pick<ChromeProps, 'role' | 'current' | 'today' | 'counts'>) {
  const t = useT();
  const item = itemsFor(role).find((i) => i.id === current);
  return (
    <header className="fixed top-0 right-0 left-64 z-20 hidden h-16 items-center gap-4 border-b border-rule bg-paper/85 px-8 backdrop-blur-md lg:flex">
      <div className="min-w-0">
        <p className="m-0 truncate font-display text-lg leading-tight font-semibold text-ink">{item ? t(item.label) : ''}</p>
        <p className="m-0 truncate text-sm leading-tight text-muted">{formatFullDate(today)}</p>
      </div>
      <div className="ml-auto flex items-center gap-2">
        <SearchTrigger onSearch={onSearch} className="w-56" />
        <AttentionBell counts={counts} />
        <ThemeToggle />
      </div>
    </header>
  );
}

/** The bell: a count of things waiting for a person, and a short list of what and where. */
function AttentionBell({ counts }: { counts: AttentionCounts }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const rows = [
    { n: counts.overdueInvoices ?? 0, label: t('bellOverdue', { n: counts.overdueInvoices ?? 0 }), href: '/app/invoice?overdue=1', ready: BILLING_PAGES_READY },
    { n: counts.draftsToReview ?? 0, label: t('bellDrafts', { n: counts.draftsToReview ?? 0 }), href: '/app/invoice?status=draft', ready: BILLING_PAGES_READY },
    { n: counts.pendingApprovals ?? 0, label: t('bellApprovals', { n: counts.pendingApprovals ?? 0 }), href: '/app', ready: false },
    { n: counts.behindDeployments, label: t('bellBehind', { n: counts.behindDeployments }), href: '/app/produk', ready: true },
  ].filter((r) => r.n > 0);
  const total = rows.reduce((s, r) => s + r.n, 0);

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
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`${t('bellOpen')}${total ? `, ${total}` : ''}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="relative grid size-9 place-items-center rounded-input border border-rule bg-key-face text-ink-2 shadow-btn transition-colors hover:bg-paper-2 hover:text-ink"
      >
        <Icon name="bell" className="size-4" />
        {total > 0 && <span aria-hidden="true" className="absolute -top-1.5 -right-1.5 grid min-w-4.5 place-items-center rounded-full bg-danger px-1 font-mono text-[10px] leading-4.5 font-semibold text-paper">{total > 99 ? '99+' : total}</span>}
      </button>
      {open && (
        <div role="dialog" aria-label={t('bellTitle')} className="pop absolute top-full right-0 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-card border border-rule bg-key-face p-2 shadow-pop">
          <p className="m-0 px-2 pt-1 pb-2 text-sm font-semibold text-ink">{t('bellTitle')}</p>
          {rows.length === 0 ? (
            <p className="m-0 px-2 pb-2 text-sm text-muted">{t('bellEmpty')}</p>
          ) : (
            <ul className="m-0 flex list-none flex-col p-0">
              {rows.map((r) => {
                const inner = (
                  <>
                    <span className="flex-1">{r.label}</span>
                    {r.ready && <Icon name="arrow" className="size-4 text-muted" />}
                  </>
                );
                return (
                  <li key={r.label}>
                    {r.ready ? <a href={r.href} className="flex min-h-10 items-center gap-2 rounded-input px-2 text-sm text-ink no-underline hover:bg-paper-2">{inner}</a> : <span className="flex min-h-10 items-center gap-2 px-2 text-sm text-ink">{inner}</span>}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function Sidebar({ organizationName, userName, role, current, counts }: ChromeProps) {
  const t = useT();
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col gap-5 overflow-y-auto border-r border-rule bg-paper-2 px-3 py-4 lg:flex">
      <a href="/app" className="flex h-10 items-center gap-3 rounded-input px-2 text-ink no-underline">
        <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent font-display text-sm font-semibold text-accent-ink">{(organizationName.trim()[0] ?? 'O').toUpperCase()}</span>
        <span className="block min-w-0 truncate font-display text-base font-semibold">{organizationName}</span>
      </a>
      <nav aria-label={t('navLabel')} className="flex flex-1 flex-col gap-5">
        {groupedFor(role).map(({ group, items }) => (
          <div key={group} className="flex flex-col gap-0.5">
            <p className="m-0 px-3 pb-1 text-xs font-medium tracking-wide text-muted uppercase">{t(GROUP_LABEL[group])}</p>
            {items.map((item) => {
              const active = current === item.id;
              return (
                <a
                  key={item.id}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={cx(
                    'group relative flex min-h-10 items-center gap-3 rounded-input px-3 text-base no-underline transition-colors duration-(--duration-micro)',
                    active ? 'bg-accent-wash font-medium text-ink' : 'text-ink-2 hover:bg-paper-3 hover:text-ink',
                  )}
                >
                  <Icon name={item.icon} className={cx('size-5 transition-colors', active ? 'text-accent' : 'text-muted group-hover:text-ink')} />
                  <span className="flex-1">{t(item.label)}</span>
                  {item.badge === 'behind' && counts.behindDeployments > 0 && <CountPill n={counts.behindDeployments} />}
                </a>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="border-t border-rule pt-3">
        <UserMenu userName={userName} role={role} />
      </div>
    </aside>
  );
}

function PhoneChrome({ organizationName, userName, role, current, counts, onSearch }: ChromeProps & { onSearch: () => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const items = itemsFor(role);
  const tabs = items.slice(0, TAB_LIMIT);

  return (
    <div className="lg:hidden">
      <header className="sticky top-0 z-30 flex items-center gap-1 border-b border-rule bg-paper/90 px-4 backdrop-blur-md pt-[env(safe-area-inset-top)] [min-height:calc(3.5rem+env(safe-area-inset-top))]">
        <LogoMark size={26} />
        <p className="m-0 min-w-0 flex-1 truncate font-display text-base font-semibold text-ink">{organizationName}</p>
        <button type="button" onClick={onSearch} aria-label={t('searchPlaceholder')} className="grid size-11 place-items-center rounded-full text-ink-2">
          <Icon name="search" />
        </button>
        <AttentionBell counts={counts} />
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={t('accountMenu')}
          aria-haspopup="dialog"
          className="grid size-11 place-items-center rounded-full"
        >
          <Avatar name={userName} size="sm" />
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
