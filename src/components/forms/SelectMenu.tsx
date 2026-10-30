import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useT } from '../../lib/use-t';
import { cx } from '../../lib/cx';
import { FloatingPanel } from '../ui/FloatingPanel';
import { useFieldControl } from './field';
import { useControllable } from './hooks';
import { controlShell } from './styles';

export interface SelectOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

interface Props {
  options: readonly SelectOption[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  /** Adds a first option with value "" labelled "All" (for filters). */
  includeAll?: boolean | string;
  /** Force search on/off. Default: on when there are more than 7 options. */
  searchable?: boolean;
  name?: string;
  size?: 'md' | 'sm';
  disabled?: boolean;
  error?: boolean;
  id?: string;
  className?: string;
  /** A last row "+ label" that closes the menu and calls `onCreate`: add what is missing without leaving the form. */
  createLabel?: string;
  onCreate?: () => void;
}

export function SelectMenu({ options, value, defaultValue = '', onChange, placeholder, includeAll, searchable, name, size = 'md', disabled, error, id, className, createLabel, onCreate }: Props) {
  const t = useT();
  const field = useFieldControl({ id, invalid: error });
  const listId = useId();
  const [current, setCurrent] = useControllable(value, defaultValue, onChange);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const trigger = useRef<HTMLButtonElement>(null);
  const shell = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const all = useMemo<SelectOption[]>(
    () => (includeAll ? [{ value: '', label: typeof includeAll === 'string' ? includeAll : t('all') }, ...options] : [...options]),
    [options, includeAll],
  );
  const hasSearch = searchable ?? all.length > 7;
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? all.filter((o) => `${o.label} ${o.description ?? ''}`.toLowerCase().includes(q)) : all;
  }, [all, query]);
  const selected = all.find((o) => o.value === current);

  const close = useCallback((refocus = false) => {
    setOpen(false);
    setQuery('');
    if (refocus) trigger.current?.focus();
  }, []);

  const openMenu = () => {
    if (disabled) return;
    const idx = Math.max(0, all.findIndex((o) => o.value === current));
    setActive(idx);
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    (hasSearch ? searchRef.current : listRef.current)?.focus();
  }, [open, hasSearch]);

  useEffect(() => {
    if (open) document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active, listId]);

  const move = (dir: 1 | -1, from = active) => {
    for (let i = from + dir; i >= 0 && i < shown.length; i += dir) {
      if (!shown[i].disabled) return setActive(i);
    }
  };
  const choose = (o: SelectOption | undefined) => {
    if (!o || o.disabled) return;
    setCurrent(o.value);
    close(true);
  };

  const onPanelKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
    else if (e.key === 'End') { e.preventDefault(); setActive(shown.length - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(shown[active]); }
    else if (e.key === 'Escape') { e.preventDefault(); close(true); }
    else if (e.key === 'Tab') close();
  };

  const activeId = shown[active] ? `${listId}-${active}` : undefined;

  return (
    <div className={className}>
      <div
        ref={shell}
        data-invalid={field.invalid || undefined}
        data-disabled={disabled || undefined}
        className={cx(controlShell, size === 'md' ? 'min-h-10 text-base' : 'min-h-8 text-sm')}
      >
        <button
          ref={trigger}
          id={field.id}
          type="button"
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-invalid={field.invalid || undefined}
          aria-describedby={field.describedBy}
          disabled={disabled}
          onClick={() => (open ? close() : openMenu())}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (!open) openMenu(); }
          }}
          className={cx('flex min-h-[inherit] w-full min-w-0 items-center justify-between gap-2 rounded-input bg-transparent text-left outline-none disabled:cursor-not-allowed', size === 'md' ? 'px-3' : 'px-2.5')}
        >
          <span className={cx('truncate', !selected && 'text-muted')}>{selected?.label ?? placeholder ?? t('choose')}</span>
          <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4 shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 6l4 4 4-4" />
          </svg>
        </button>
      </div>
      {name && <input type="hidden" name={name} value={current} />}
      <FloatingPanel anchorRef={shell} open={open} onClose={() => close()} matchWidth className="max-h-72 overflow-hidden">
        <div onKeyDown={onPanelKey} className="flex max-h-72 flex-col">
          {hasSearch && (
            <div className="border-b border-rule p-2">
              <input
                ref={searchRef}
                type="text"
                role="searchbox"
                value={query}
                placeholder={t('search')}
                aria-label={t('search')}
                aria-controls={listId}
                aria-activedescendant={activeId}
                onChange={(e) => { setQuery(e.currentTarget.value); setActive(0); }}
                className="w-full rounded-input border border-rule-2 bg-paper px-2 py-1.5 text-sm text-ink outline-none placeholder:text-muted focus:border-accent"
              />
            </div>
          )}
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            tabIndex={hasSearch ? undefined : -1}
            aria-activedescendant={hasSearch ? undefined : activeId}
            aria-labelledby={field.labelId}
            className="m-0 flex-1 list-none overflow-auto p-1 outline-none"
          >
            {shown.length === 0 && <li role="presentation" className="px-3 py-2 text-sm text-muted">{t('noResults')}</li>}
            {shown.map((o, i) => (
              <li
                key={o.value || '__all'}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={o.value === current}
                aria-disabled={o.disabled || undefined}
                onPointerMove={() => !o.disabled && setActive(i)}
                onClick={() => choose(o)}
                className={cx(
                  'flex cursor-pointer items-start justify-between gap-3 rounded px-3 py-2 text-sm text-ink',
                  i === active && 'bg-accent-wash',
                  o.disabled && 'cursor-not-allowed opacity-50',
                )}
              >
                <span>
                  <span className="block">{o.label}</span>
                  {o.description && <span className="block text-xs text-muted">{o.description}</span>}
                </span>
                {o.value === current && <span aria-hidden="true" className="text-accent">✓</span>}
              </li>
            ))}
          </ul>
          {onCreate && createLabel && (
            <button
              type="button"
              onClick={() => { close(); onCreate(); }}
              className="flex w-full items-center gap-2 border-t border-rule px-4 py-2.5 text-left text-sm font-medium text-accent hover:bg-accent-wash"
            >
              <span aria-hidden="true">+</span>
              {createLabel}
            </button>
          )}
        </div>
      </FloatingPanel>
    </div>
  );
}
