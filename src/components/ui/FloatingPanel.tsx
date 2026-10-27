import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { cx } from '../../lib/cx';

interface Props {
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  /** Make the panel at least as wide as the anchor (dropdowns). */
  matchWidth?: boolean;
  children: ReactNode;
  className?: string;
}

// Fixed from the first render so the panel shrink-wraps its content when measured.
const HIDDEN: React.CSSProperties = { position: 'fixed', top: 0, left: 0, visibility: 'hidden' };

/**
 * Renders into document.body with fixed positioning so a container with
 * overflow:hidden never clips it. Flips above the anchor when there is no room below.
 */
export function FloatingPanel({ anchorRef, open, onClose, matchWidth = false, children, className }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>(HIDDEN);

  useLayoutEffect(() => {
    if (!open) { setStyle(HIDDEN); return; }
    const place = () => {
      const anchor = anchorRef.current;
      const panel = panelRef.current;
      if (!anchor || !panel) return;
      const a = anchor.getBoundingClientRect();
      const h = panel.offsetHeight;
      const below = window.innerHeight - a.bottom;
      const top = below < h + 8 && a.top > below ? Math.max(8, a.top - h - 4) : a.bottom + 4;
      const left = Math.min(Math.max(8, a.left), Math.max(8, window.innerWidth - panel.offsetWidth - 8));
      setStyle({ position: 'fixed', top, left, minWidth: matchWidth ? a.width : undefined, visibility: 'visible' });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, anchorRef, matchWidth]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open, onClose, anchorRef]);

  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <div ref={panelRef} style={style} className={cx('z-50 rounded-card border border-rule-2 bg-paper shadow-pop', className)}>
      {children}
    </div>,
    document.body,
  );
}
