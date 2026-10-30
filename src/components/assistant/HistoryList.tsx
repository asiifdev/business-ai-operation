import { useEffect, useRef, useState } from 'react';
import { cx } from '../../lib/cx';
import { useLocale, useT } from '../../lib/use-t';
import { Icon } from '../shell/Icon';
import { Skeleton } from '../ui/states';
import type { SessionSummary } from './useAssistant';

type Group = 'historyToday' | 'historyYesterday' | 'historyWeek' | 'historyOlder';

/** Which heading a conversation belongs under, by the day it was last used (the browser's own day, which is the person's). */
function groupOf(iso: string, now: Date): Group {
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((day(now) - day(new Date(iso))) / 86_400_000);
  return diff <= 0 ? 'historyToday' : diff === 1 ? 'historyYesterday' : diff <= 7 ? 'historyWeek' : 'historyOlder';
}

/**
 * The person's earlier conversations with the assistant, grouped by day, with search, rename and delete. Used beside the
 * full page and inside the side panel; opening one carries on in the same place.
 */
export function HistoryList({ sessions, currentId, onOpen, onNew, onSearch, onRename, onDelete, onDone }: {
  sessions: SessionSummary[] | null;
  currentId: string | null;
  onOpen: (id: string) => void;
  onNew: () => void;
  onSearch: (q: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  /** Called after a choice that leaves the list (the side panel returns to the conversation). */
  onDone?: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  const first = useRef(true);

  // Search on the server after a short pause, so a long history is never filtered in the browser.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const timer = window.setTimeout(() => onSearch(query), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  const now = new Date();
  const groups = (['historyToday', 'historyYesterday', 'historyWeek', 'historyOlder'] as const)
    .map((key) => ({ key, items: (sessions ?? []).filter((s) => groupOf(s.updatedAt, now) === key) }))
    .filter((g) => g.items.length > 0);
  const when = (iso: string) => new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

  function save(id: string) {
    if (draft.trim()) onRename(id, draft);
    setEditing(null);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <button
        type="button"
        onClick={() => { onNew(); onDone?.(); }}
        className="flex min-h-10 items-center justify-center gap-2 rounded-input border border-rule bg-key-face px-3 text-sm font-medium text-ink shadow-btn transition-colors duration-(--duration-micro) hover:border-accent/50 hover:bg-accent-wash"
      >
        <Icon name="plus" className="size-4" />
        {t('historyNew')}
      </button>
      <div className="relative">
        <Icon name="search" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          placeholder={t('historySearch')}
          aria-label={t('historySearch')}
          className="min-h-9 w-full rounded-input border border-rule-2 bg-paper pr-3 pl-9 text-sm text-ink outline-none placeholder:text-muted focus:border-accent"
        />
      </div>

      <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-1" aria-busy={sessions === null}>
        {sessions === null && <Skeleton rows={4} />}
        {sessions !== null && sessions.length === 0 && <p className="m-0 px-1 text-sm text-muted">{query.trim() ? t('historyNoMatch') : t('historyEmpty')}</p>}
        {groups.map((g) => (
          <section key={g.key} aria-label={t(g.key)}>
            <h3 className="m-0 mb-1 px-2 text-xs font-medium text-muted">{t(g.key)}</h3>
            <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
              {g.items.map((s) => (
                <li key={s.id} className={cx('group rounded-input', s.id === currentId ? 'bg-accent-wash' : 'hover:bg-paper-2')}>
                  {editing === s.id ? (
                    <form className="flex items-center gap-1 p-1.5" onSubmit={(e) => { e.preventDefault(); save(s.id); }}>
                      <input
                        autoFocus
                        onFocus={(e) => e.currentTarget.select()}
                        value={draft}
                        maxLength={80}
                        onChange={(e) => setDraft(e.currentTarget.value)}
                        onKeyDown={(e) => e.key === 'Escape' && setEditing(null)}
                        aria-label={t('historyRename')}
                        className="min-h-8 min-w-0 flex-1 rounded-input border border-rule-2 bg-paper px-2 text-sm text-ink outline-none focus:border-accent"
                      />
                      <button type="submit" className="min-h-8 rounded-input px-2 text-sm font-medium text-accent hover:bg-paper-2">{t('historySave')}</button>
                    </form>
                  ) : deleting === s.id ? (
                    <div className="flex items-center gap-2 px-2 py-1.5 text-sm" role="group" aria-label={t('confirmSure')}>
                      <span className="min-w-0 flex-1 truncate text-ink">{t('confirmSure')}</span>
                      <button type="button" onClick={() => { onDelete(s.id); setDeleting(null); }} className="rounded-input px-2 py-1 font-medium text-danger hover:bg-danger-wash">{t('historyDelete')}</button>
                      <button type="button" onClick={() => setDeleting(null)} className="rounded-input px-2 py-1 text-ink-2 hover:bg-paper-2">{t('cancel')}</button>
                    </div>
                  ) : (
                    <div className="flex items-center">
                      <button type="button" onClick={() => { onOpen(s.id); onDone?.(); }} aria-current={s.id === currentId || undefined} className="flex min-w-0 flex-1 flex-col items-start gap-0.5 rounded-input px-2 py-1.5 text-left">
                        <span className="w-full truncate text-sm text-ink">{s.title}</span>
                        <span className="text-xs text-muted">{when(s.updatedAt)}</span>
                      </button>
                      <span className="flex shrink-0 pr-1 opacity-0 transition-opacity duration-(--duration-micro) group-focus-within:opacity-100 group-hover:opacity-100 max-lg:opacity-100">
                        <button type="button" aria-label={t('historyRename')} title={t('historyRename')} onClick={() => { setDraft(s.title); setEditing(s.id); }} className="grid size-8 place-items-center rounded-full text-muted hover:bg-paper-3 hover:text-ink">
                          <Icon name="edit" className="size-4" />
                        </button>
                        <button type="button" aria-label={t('historyDelete')} title={t('historyDelete')} onClick={() => setDeleting(s.id)} className="grid size-8 place-items-center rounded-full text-muted hover:bg-danger-wash hover:text-danger">
                          <Icon name="trash" className="size-4" />
                        </button>
                      </span>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
