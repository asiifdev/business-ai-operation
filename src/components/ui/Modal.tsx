import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cx } from '../../lib/cx';
import { useT } from '../../lib/use-t';
import { Icon } from '../shell/Icon';

type Placement = 'center' | 'right' | 'bottom';

const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

const PANEL: Record<Placement, string> = {
  center: 'modal-center top-1/2 left-1/2 max-h-[85dvh] w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-card border',
  right: 'modal-right inset-y-0 right-0 w-[min(28rem,100vw)] border-l',
  bottom: 'sheet inset-x-0 bottom-0 max-h-[85dvh] rounded-t-2xl border-t pb-[env(safe-area-inset-bottom)]',
};

/**
 * One dialog for the app: centred for a short decision, from the right for a side task (the assistant), from the bottom
 * on a phone. Focus moves in on open, stays inside while it is open and goes back where it was on close; Escape, the
 * backdrop and the close button all close it; the page behind does not scroll. A modal is the last answer: prefer
 * inline editing or a disclosure where one fits.
 */
export function Modal({ open, onClose, title, placement = 'center', actions, children, bodyClassName, initialFocus }: {
  open: boolean;
  onClose: () => void;
  title: string;
  placement?: Placement;
  /** Extra buttons in the header, before the close button. */
  actions?: ReactNode;
  children: ReactNode;
  bodyClassName?: string;
  /** Focus this element on open instead of the close button (a composer, the first field). */
  initialFocus?: React.RefObject<HTMLElement | null>;
}) {
  const t = useT();
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    (initialFocus?.current ?? closeRef.current)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !panel.current) return;
      const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, [open, initialFocus]);

  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-50">
      <div aria-hidden="true" onClick={onClose} className="palette-backdrop absolute inset-0 bg-scrim/55" />
      <div ref={panel} role="dialog" aria-modal="true" aria-label={title} className={cx('absolute flex flex-col border-rule bg-paper shadow-pop', PANEL[placement])}>
        {placement === 'bottom' && <span aria-hidden="true" className="mx-auto mt-3 h-1 w-10 shrink-0 rounded-full bg-rule-2" />}
        <header className="flex shrink-0 items-center gap-2 border-b border-rule px-4 py-3">
          <h2 className="m-0 min-w-0 flex-1 truncate text-lg font-semibold text-ink">{title}</h2>
          {actions}
          <button ref={closeRef} type="button" onClick={onClose} aria-label={t('modalClose')} className="grid size-10 place-items-center rounded-full text-ink-2 transition-colors duration-(--duration-micro) hover:bg-paper-2 hover:text-ink">
            <Icon name="close" />
          </button>
        </header>
        <div className={cx('min-h-0 flex-1 overflow-y-auto p-4', bodyClassName)}>{children}</div>
      </div>
    </div>,
    document.body,
  );
}
