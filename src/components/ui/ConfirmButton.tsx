import { useState, type ReactNode } from 'react';
import { useT } from '../../lib/use-t';
import { Button } from './Button';
import { Modal } from './Modal';

interface Props {
  children: ReactNode;
  onConfirm: () => void | Promise<void>;
  variant?: 'primary' | 'secondary' | 'danger';
  busy?: boolean;
  disabled?: boolean;
  /** The dialog's question. Defaults to a plain "Are you sure?"; say what will happen when the action needs it. */
  message?: ReactNode;
}

/**
 * An action behind a confirmation dialog. The button keeps its place on the page; pressing it opens a short dialog titled
 * with the button's own label, and the confirm button there repeats that label, so the person reads what they are about
 * to do. "Cancel", Escape and the backdrop all leave the action undone.
 */
export function ConfirmButton({ children, onConfirm, variant = 'secondary', busy = false, disabled = false, message }: Props) {
  const t = useT();
  const [asking, setAsking] = useState(false);
  const [running, setRunning] = useState(false);
  const title = typeof children === 'string' ? children : t('confirmSure');
  const close = () => !running && setAsking(false);

  async function run() {
    setRunning(true);
    try {
      await onConfirm();
    } finally {
      setRunning(false);
      setAsking(false);
    }
  }

  return (
    <>
      <Button size="sm" variant={variant} onClick={() => setAsking(true)} disabled={disabled}>{children}</Button>
      <Modal open={asking} onClose={close} title={title}>
        <div className="flex flex-col gap-5">
          <p className="m-0 text-ink-2">{message ?? t('confirmSure')}</p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button onClick={close} disabled={running}>{t('cancel')}</Button>
            <Button variant={variant === 'secondary' ? 'primary' : variant} loading={running || busy} onClick={run}>{children}</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
