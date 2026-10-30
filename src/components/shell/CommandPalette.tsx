import { useEffect, useMemo, useRef, useState } from 'react';
import type { Role } from '../../domain/permissions';
import { api } from '../../lib/api-client';
import { cx } from '../../lib/cx';
import type { MessageKey } from '../../lib/i18n';
import { itemsFor, type IconName } from '../../lib/nav';
import { useT } from '../../lib/use-t';
import { Icon } from './Icon';

interface Entry {
  id: string;
  label: string;
  hint?: string;
  href: string;
  icon: IconName;
  group: 'navigate' | 'actions' | 'clients' | 'ask';
}

const GROUP_KEY = { navigate: 'cmdNavigate', actions: 'cmdActions', clients: 'cmdClients', ask: 'cmdAsk' } as const satisfies Record<Entry['group'], MessageKey>;

/**
 * The ⌘K search and jump box. It lists the pages and quick actions the person may use, and looks up clients as they
 * type. Everything is a plain link, so the palette adds no way to change data: it only takes you to where you can. A
 * typed question can also go to the assistant (chat-first): `onAsk` opens the side panel, otherwise the assistant page.
 */
export function CommandPalette({ open, onClose, role, onAsk }: { open: boolean; onClose: () => void; role: Role; onAsk?: (question: string) => void }) {
  const t = useT();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [clients, setClients] = useState<{ id: string; name: string; contactName: string | null }[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const base = useMemo<Entry[]>(
    () => [
      ...itemsFor(role).map((i) => ({ id: `nav-${i.id}`, label: t(i.label), href: i.href, icon: i.icon, group: 'navigate' as const })),
      { id: 'act-client', label: t('cmdNewClient'), href: '/app/klien?new=1', icon: 'plus', group: 'actions' },
      { id: 'act-product', label: t('cmdNewProduct'), href: '/app/produk?new=1', icon: 'plus', group: 'actions' },
      { id: 'act-assistant', label: t('cmdAskAssistant'), href: '/app/asisten', icon: 'assistant', group: 'actions' },
    ],
    [role, t],
  );

  useEffect(() => {
    if (!open) return;
    setQ('');
    setActive(0);
    setClients([]);
    const previous = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, [open]);

  // Look clients up after a short pause in typing; an older answer never replaces a newer one.
  useEffect(() => {
    const term = q.trim();
    if (!open || term.length < 2) {
      setClients([]);
      return;
    }
    let stale = false;
    const timer = setTimeout(() => {
      api<{ clients: { id: string; name: string; contactName: string | null }[] }>('GET', `/api/clients?${new URLSearchParams({ q: term })}`)
        .then((r) => !stale && setClients(r.clients.slice(0, 5)))
        .catch(() => !stale && setClients([]));
    }, 180);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [q, open]);

  const entries = useMemo(() => {
    const term = q.trim().toLowerCase();
    const matched = term ? base.filter((e) => e.label.toLowerCase().includes(term)) : base;
    const found: Entry[] = clients.map((c) => ({ id: `client-${c.id}`, label: c.name, hint: c.contactName ?? undefined, href: `/app/klien/${c.id}`, icon: 'clients', group: 'clients' }));
    const question = q.trim();
    const ask: Entry[] = question.length >= 3 ? [{ id: 'ask', label: t('cmdAskQuestion', { q: question }), href: `/app/asisten?${new URLSearchParams({ q: question })}`, icon: 'assistant', group: 'ask' }] : [];
    return [...found, ...matched, ...ask];
  }, [q, base, clients, t]);

  useEffect(() => setActive(0), [q, clients]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;

  const go = (entry: Entry | undefined) => {
    if (!entry) return;
    onClose();
    if (entry.group === 'ask' && onAsk) onAsk(q.trim());
    else window.location.assign(entry.href);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
    else if (e.key === 'ArrowDown') (e.preventDefault(), setActive((i) => Math.min(i + 1, entries.length - 1)));
    else if (e.key === 'ArrowUp') (e.preventDefault(), setActive((i) => Math.max(i - 1, 0)));
    else if (e.key === 'Enter') (e.preventDefault(), go(entries[active]));
  };

  let lastGroup: Entry['group'] | null = null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12dvh]" onKeyDown={onKeyDown}>
      <div aria-hidden="true" onClick={onClose} className="palette-backdrop absolute inset-0 bg-scrim/55 backdrop-blur-[2px]" />
      <div role="dialog" aria-modal="true" aria-label={t('searchPlaceholder')} className="palette relative flex max-h-[70dvh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-rule bg-key-face shadow-pop">
        <div className="flex items-center gap-3 border-b border-rule px-4">
          <Icon name="search" className="size-5 shrink-0 text-muted" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.currentTarget.value)}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={entries[active] ? `palette-${entries[active].id}` : undefined}
            placeholder={t('searchPlaceholder')}
            className="h-14 min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-muted"
          />
          <button type="button" onClick={onClose} aria-label={t('cmdClose')} className="grid size-8 place-items-center rounded-input text-muted hover:bg-paper-2 hover:text-ink">
            <Icon name="close" className="size-4" />
          </button>
        </div>
        <ul ref={listRef} id="palette-list" role="listbox" className="m-0 flex-1 list-none overflow-y-auto p-2">
          {entries.length === 0 && <li className="px-3 py-8 text-center text-sm text-muted">{t('cmdNoMatch', { q: q.trim() })}</li>}
          {entries.map((e, i) => {
            const heading = e.group !== lastGroup;
            lastGroup = e.group;
            return (
              <li key={e.id} role="presentation">
                {heading && <p className="m-0 px-3 pt-3 pb-1 text-sm text-muted">{t(GROUP_KEY[e.group])}</p>}
                <a
                  id={`palette-${e.id}`}
                  data-index={i}
                  role="option"
                  aria-selected={i === active}
                  href={e.href}
                  onMouseMove={() => setActive(i)}
                  onClick={(ev) => (ev.preventDefault(), go(e))}
                  className={cx('flex min-h-11 items-center gap-3 rounded-input px-3 text-base no-underline', i === active ? 'bg-accent-wash text-ink' : 'text-ink-2')}
                >
                  <Icon name={e.icon} className={cx('size-5 shrink-0', i === active ? 'text-accent' : 'text-muted')} />
                  <span className="min-w-0 flex-1 truncate">{e.label}</span>
                  {e.hint && <span className="hidden truncate text-sm text-muted sm:block">{e.hint}</span>}
                  {i === active && <Icon name="arrow" className="size-4 shrink-0 text-accent" />}
                </a>
              </li>
            );
          })}
        </ul>
        <p className="m-0 hidden border-t border-rule bg-paper-2 px-4 py-2 text-xs text-muted sm:block">{t('cmdHint')}</p>
      </div>
    </div>
  );
}
