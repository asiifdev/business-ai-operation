import { useId, type ReactNode } from 'react';
import { cx } from '../../lib/cx';
import { useFieldControl } from './field';
import { useControllable } from './hooks';

interface CheckboxProps {
  label: ReactNode;
  description?: ReactNode;
  checked?: boolean;
  defaultChecked?: boolean;
  onChange?: (checked: boolean) => void;
  name?: string;
  value?: string;
  disabled?: boolean;
  error?: boolean;
  id?: string;
  className?: string;
}

const row =
  'group flex cursor-pointer items-start gap-3 rounded-input p-2 transition-colors duration-(--duration-micro) hover:bg-paper-2 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50 has-[:disabled]:hover:bg-transparent';

export function Checkbox({ label, description, checked, defaultChecked = false, onChange, name, value = 'on', disabled, error, id, className }: CheckboxProps) {
  const field = useFieldControl({ id, invalid: error });
  const descId = useId();
  const [on, setOn] = useControllable(checked, defaultChecked, onChange);
  return (
    <label className={cx(row, className)}>
      <input
        id={field.id}
        type="checkbox"
        name={name}
        value={value}
        checked={on}
        disabled={disabled}
        aria-invalid={field.invalid || undefined}
        aria-describedby={description ? descId : field.describedBy}
        onChange={(e) => setOn(e.currentTarget.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden="true"
        className={cx(
          'mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded border bg-paper text-accent-ink transition-colors duration-(--duration-micro)',
          'border-rule-2 group-hover:border-muted peer-checked:border-accent peer-checked:bg-accent peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus',
          field.invalid && 'border-danger',
        )}
      >
        <svg viewBox="0 0 16 16" className={cx('size-3.5', !on && 'opacity-0')} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3.5 8.5l3 3 6-7" />
        </svg>
      </span>
      <span className="flex flex-col">
        <span className="text-base text-ink">{label}</span>
        {description && <span id={descId} className="text-sm text-muted">{description}</span>}
      </span>
    </label>
  );
}

interface GroupOption { value: string; label: ReactNode; description?: ReactNode; disabled?: boolean }

interface GroupProps {
  options: readonly GroupOption[];
  value?: readonly string[];
  defaultValue?: readonly string[];
  onChange?: (values: string[]) => void;
  name?: string;
  disabled?: boolean;
  className?: string;
}

/** A set of checkboxes sharing one value array. Name it with FormField's label (aria-labelledby). */
export function CheckboxGroup({ options, value, defaultValue = [], onChange, name, disabled, className }: GroupProps) {
  const field = useFieldControl();
  const [values, setValues] = useControllable<readonly string[]>(value, defaultValue, onChange as ((v: readonly string[]) => void) | undefined);
  return (
    <div role="group" aria-labelledby={field.labelId} aria-describedby={field.describedBy} className={cx('flex flex-col', className)}>
      {options.map((o) => (
        <Checkbox
          key={o.value}
          label={o.label}
          description={o.description}
          name={name}
          value={o.value}
          disabled={disabled || o.disabled}
          checked={values.includes(o.value)}
          onChange={(on) => setValues(on ? [...values, o.value] : values.filter((v) => v !== o.value))}
        />
      ))}
    </div>
  );
}
