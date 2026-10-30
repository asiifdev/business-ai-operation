import { useEffect, useState } from 'react';
import { cx } from '../../lib/cx';
import { useT } from '../../lib/use-t';
import { Icon } from '../shell/Icon';

type Tone = 'success' | 'danger' | 'neutral';
interface Item { id: number; text: string; tone: Tone }

const EVENT = 'orbyte:toast';
const LIFETIME = 5000;
let nextId = 1;

/**
 * Short feedback after an action ("Run continues from the failed step"). Anyone can call it; the one `Toaster` in the app
 * shell shows it. Never the only place a result is said: the page itself also shows the new state.
 */
export function toast(text: string, tone: Tone = 'success') {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<Item>(EVENT, { detail: { id: nextId++, text, tone } }));
}

const ICON = { success: 'check', danger: 'alert', neutral: 'bell' } as const;
const MARK: Record<Tone, string> = { success: 'text-success', danger: 'text-danger', neutral: 'text-muted' };

/** The stack of toasts, announced politely. Mounted once, by the app shell. Each one leaves after five seconds or on close. */
export function Toaster() {
  const t = useT();
  const [items, setItems] = useState<Item[]>([]);

  useEffect(() => {
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const onToast = (e: Event) => {
      const item = (e as CustomEvent<Item>).detail;
      setItems((list) => [...list.slice(-2), item]);
      const timer = setTimeout(() => {
        setItems((list) => list.filter((x) => x.id !== item.id));
        timers.delete(timer);
      }, LIFETIME);
      timers.add(timer);
    };
    window.addEventListener(EVENT, onToast);
    return () => {
      window.removeEventListener(EVENT, onToast);
      timers.forEach(clearTimeout);
    };
  }, []);

  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-[60] flex flex-col items-center gap-2 lg:inset-x-auto lg:right-6 lg:bottom-6 lg:items-end">
      {items.map((item) => (
        <div key={item.id} className="pop pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-card border border-rule bg-key-face py-3 pr-2 pl-4 shadow-pop">
          <Icon name={ICON[item.tone]} className={cx('mt-0.5 size-4 shrink-0', MARK[item.tone])} />
          <p className="m-0 flex-1 text-sm text-ink">{item.text}</p>
          <button type="button" onClick={() => setItems((list) => list.filter((x) => x.id !== item.id))} aria-label={t('toastDismiss')} className="grid size-8 shrink-0 place-items-center rounded-full text-muted transition-colors duration-(--duration-micro) hover:bg-paper-2 hover:text-ink">
            <Icon name="close" className="size-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
