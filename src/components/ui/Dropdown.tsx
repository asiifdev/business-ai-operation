import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from '../../lib/cx';
import { useT } from '../../lib/use-t';
import { Icon } from '../shell/Icon';
import { buttonClasses } from './Button';
import { FloatingPanel } from './FloatingPanel';

export type DropdownItem =
  | { id: string; label: ReactNode; href: string; download?: boolean; danger?: boolean }
  | { id: string; label: ReactNode; onSelect: () => void; danger?: boolean; disabled?: boolean };

/**
 * A button that opens a short list of actions (the menu pattern): secondary actions that would crowd a header. Arrow keys
 * move, Home/End jump, Enter or Space chooses, Escape closes and returns focus to the button. Each item is a link or a
 * button, never both. Destructive actions still confirm on their own page or with `ConfirmButton`.
 */
export function Dropdown({ items, label, children, align = 'end', size = 'sm' }: {
  items: readonly DropdownItem[];
  /** The button's accessible name when it shows only an icon. Defaults to "More actions". */
  label?: string;
  /** The button's visible content. Defaults to a three-dot icon. */
  children?: ReactNode;
  align?: 'start' | 'end';
  size?: 'md' | 'sm';
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const menuId = useId();

  const focusItem = (index: number) => {
    const els = [...(list.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? [])];
    if (els.length === 0) return;
    els[(index + els.length) % els.length]!.focus();
  };

  useEffect(() => {
    if (open) requestAnimationFrame(() => focusItem(0));
  }, [open]);

  function close(returnFocus = true) {
    setOpen(false);
    if (returnFocus) button.current?.focus();
  }

  function onMenuKey(e: KeyboardEvent<HTMLUListElement>) {
    const els = [...(list.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? [])];
    const at = els.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') (e.preventDefault(), focusItem(at + 1));
    else if (e.key === 'ArrowUp') (e.preventDefault(), focusItem(at - 1));
    else if (e.key === 'Home') (e.preventDefault(), focusItem(0));
    else if (e.key === 'End') (e.preventDefault(), focusItem(els.length - 1));
    else if (e.key === 'Escape') (e.preventDefault(), close());
    else if (e.key === 'Tab') close(false);
  }

  const itemClass = (danger?: boolean) =>
    cx('flex min-h-10 w-full items-center gap-2 rounded-input px-3 text-left text-sm no-underline transition-colors duration-(--duration-micro) hover:bg-paper-2 focus:bg-paper-2 focus:outline-none active:bg-paper-3 aria-disabled:cursor-not-allowed aria-disabled:opacity-50', danger ? 'text-danger' : 'text-ink');

  return (
    <>
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={children ? undefined : (label ?? t('menuMore'))}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className={buttonClasses('secondary', size, children ? undefined : '!px-2')}
      >
        {children ?? <Icon name="more" className="size-5" />}
      </button>
      <FloatingPanel anchorRef={button} open={open} onClose={() => setOpen(false)} className={cx('pop min-w-48 p-1', align === 'end' && 'origin-top-right')}>
        <ul ref={list} id={menuId} role="menu" aria-label={label ?? t('menuMore')} onKeyDown={onMenuKey} className="m-0 flex list-none flex-col p-0">
          {items.map((item) => (
            <li key={item.id} role="none">
              {'href' in item ? (
                <a role="menuitem" tabIndex={-1} href={item.href} download={item.download || undefined} onClick={() => setOpen(false)} className={itemClass(item.danger)}>
                  {item.label}
                </a>
              ) : (
                <button
                  role="menuitem"
                  type="button"
                  tabIndex={-1}
                  aria-disabled={item.disabled || undefined}
                  onClick={() => {
                    if (item.disabled) return;
                    close();
                    item.onSelect();
                  }}
                  className={itemClass(item.danger)}
                >
                  {item.label}
                </button>
              )}
            </li>
          ))}
        </ul>
      </FloatingPanel>
    </>
  );
}
