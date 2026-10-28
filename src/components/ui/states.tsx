import type { ReactNode } from 'react';
import { useT } from '../../lib/use-t';
import { Button } from './Button';

/** A grey bar stand-in in the shape of what is loading. */
export function Skeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div aria-hidden="true" className="flex flex-col gap-3">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-8 w-full rounded bg-paper-2" />
      ))}
    </div>
  );
}

/** What broke and what to do: say it, and offer to try again. */
export function ErrorBox({ onRetry, children }: { onRetry?: () => void; children?: ReactNode }) {
  const t = useT();
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3">
      <p className="m-0 text-ink">{children ?? t('loadError')}</p>
      {onRetry && <Button size="sm" onClick={onRetry}>{t('assistantRetry')}</Button>}
    </div>
  );
}

/** Nothing here yet: what belongs here and the one action that fills it. */
export function EmptyState({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-3 py-2">
      <p className="m-0 max-w-prose text-ink">{children}</p>
      {action}
    </div>
  );
}
