import { useState, type ReactNode } from 'react';
import { useT } from '../../lib/use-t';
import { Button } from './Button';

interface Props {
  children: ReactNode;
  onConfirm: () => void | Promise<void>;
  variant?: 'secondary' | 'danger';
  busy?: boolean;
  disabled?: boolean;
}

/** A destructive action behind a second click, inline: no modal. "Yes" runs it, "Cancel" puts the button back. */
export function ConfirmButton({ children, onConfirm, variant = 'secondary', busy = false, disabled = false }: Props) {
  const t = useT();
  const [asking, setAsking] = useState(false);
  if (!asking) return <Button size="sm" variant={variant} onClick={() => setAsking(true)} disabled={disabled}>{children}</Button>;
  return (
    <span className="inline-flex flex-wrap items-center gap-2" role="group" aria-label={t('confirmSure')}>
      <span className="text-sm text-ink">{t('confirmSure')}</span>
      <Button size="sm" variant={variant} loading={busy} onClick={async () => { await onConfirm(); setAsking(false); }}>{t('confirmYes')}</Button>
      <Button size="sm" onClick={() => setAsking(false)} disabled={busy}>{t('cancel')}</Button>
    </span>
  );
}
