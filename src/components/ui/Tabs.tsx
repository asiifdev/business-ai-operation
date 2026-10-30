import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from '../../lib/cx';

export interface TabItem<T extends string> {
  id: T;
  label: ReactNode;
  /** A small count beside the label ("Open 3"). */
  count?: number;
}

/**
 * A row of views over the same content (Open / Snoozed / Closed). Keyboard as the ARIA pattern asks: one tab stop, the
 * arrow keys move between tabs and select them, Home and End jump to the ends. The caller keeps the value, so it can live
 * in the URL.
 */
export function Tabs<T extends string>({ label, items, value, onChange, className }: {
  /** Names the set for assistive technology. */
  label: string;
  items: readonly TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  className?: string;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = items.length - 1;
    const next = e.key === 'ArrowRight' ? (index === last ? 0 : index + 1) : e.key === 'ArrowLeft' ? (index === 0 ? last : index - 1) : e.key === 'Home' ? 0 : e.key === 'End' ? last : null;
    if (next === null) return;
    e.preventDefault();
    onChange(items[next]!.id);
    refs.current[next]?.focus();
  }

  return (
    <div role="tablist" aria-label={label} className={cx('flex gap-1 overflow-x-auto border-b border-rule', className)}>
      {items.map((item, i) => {
        const selected = item.id === value;
        return (
          <button
            key={item.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            role="tab"
            type="button"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(item.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cx(
              '-mb-px inline-flex min-h-11 shrink-0 items-center gap-2 border-b-2 px-3 text-sm font-medium whitespace-nowrap transition-colors duration-(--duration-micro)',
              selected ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink active:text-ink',
            )}
          >
            {item.label}
            {item.count != null && <span className={cx('rounded-full px-1.5 font-mono text-xs tabular-nums', selected ? 'bg-accent-wash text-accent' : 'bg-paper-2 text-muted')}>{item.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
