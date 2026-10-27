import { useId, type ReactNode } from 'react';
import { cx } from '../../lib/cx';
import { useControllable } from './hooks';

interface Props {
  label: ReactNode;
  /** Say what happens when it is on, in business language. */
  description?: ReactNode;
  checked?: boolean;
  defaultChecked?: boolean;
  onChange?: (checked: boolean) => void;
  /** The submitted value is "true" or "false"; the off state is always sent too. */
  name?: string;
  disabled?: boolean;
  className?: string;
}

export function Toggle({ label, description, checked, defaultChecked = false, onChange, name, disabled, className }: Props) {
  const labelId = useId();
  const descId = useId();
  const [on, setOn] = useControllable(checked, defaultChecked, onChange);
  return (
    <label className={cx('flex cursor-pointer items-start justify-between gap-4 rounded-input p-2 transition-colors duration-(--duration-micro) hover:bg-paper-2 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50 has-[:disabled]:hover:bg-transparent', className)}>
      <span className="flex flex-col">
        <span id={labelId} className="text-base text-ink">{label}</span>
        {description && <span id={descId} className="text-sm text-muted">{description}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-labelledby={labelId}
        aria-describedby={description ? descId : undefined}
        disabled={disabled}
        onClick={() => setOn(!on)}
        className={cx(
          'relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors duration-(--duration-micro) disabled:cursor-not-allowed',
          on ? 'border-accent-edge bg-accent' : 'border-rule-2 bg-paper-3',
        )}
      >
        <span aria-hidden="true" className={cx('absolute left-0.5 size-4.5 rounded-full bg-paper shadow-card transition-transform duration-(--duration-micro) ease-(--ease-out)', on && 'translate-x-5')} />
      </button>
      {name && <input type="hidden" name={name} value={on ? 'true' : 'false'} />}
    </label>
  );
}
