import { useId, type ReactNode } from 'react';
import { cx } from '../../lib/cx';
import { useFieldControl } from './field';
import { useControllable } from './hooks';

interface Option { value: string; label: ReactNode; description?: ReactNode; disabled?: boolean }

interface Props {
  options: readonly Option[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  name?: string;
  /** "segmented" suits 2-4 short options. */
  variant?: 'list' | 'segmented';
  disabled?: boolean;
  className?: string;
}

/** Single choice. Native radios underneath, so arrow-key navigation and form submission just work. */
export function RadioGroup({ options, value, defaultValue = '', onChange, name, variant = 'list', disabled, className }: Props) {
  const field = useFieldControl();
  const auto = useId();
  const group = name ?? auto;
  const [current, setCurrent] = useControllable(value, defaultValue, onChange);

  const input = (o: Option) => (
    <input
      type="radio"
      name={group}
      value={o.value}
      checked={current === o.value}
      disabled={disabled || o.disabled}
      onChange={() => setCurrent(o.value)}
      className="peer sr-only"
    />
  );

  if (variant === 'segmented') {
    return (
      <div role="radiogroup" aria-labelledby={field.labelId} aria-describedby={field.describedBy} className={cx('inline-flex gap-1 rounded-input border border-rule bg-paper-3 p-1', className)}>
        {options.map((o) => (
          <label
            key={o.value}
            className="relative flex min-h-8 cursor-pointer items-center rounded px-3 text-sm font-medium text-ink-2 transition-[background-color,color,box-shadow] duration-(--duration-micro) hover:text-ink has-[:checked]:bg-paper has-[:checked]:text-ink has-[:checked]:shadow-card has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus"
          >
            {input(o)}
            {o.label}
          </label>
        ))}
      </div>
    );
  }

  return (
    <div role="radiogroup" aria-labelledby={field.labelId} aria-describedby={field.describedBy} className={cx('flex flex-col', className)}>
      {options.map((o) => (
        <label
          key={o.value}
          className="group flex cursor-pointer items-start gap-3 rounded-input p-2 transition-colors duration-(--duration-micro) hover:bg-paper-2 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50 has-[:disabled]:hover:bg-transparent"
        >
          {input(o)}
          <span aria-hidden="true" className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full border border-rule-2 bg-paper transition-colors duration-(--duration-micro) group-hover:border-muted peer-checked:border-accent peer-checked:[&>span]:scale-100 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus">
            <span className="size-2.5 scale-0 rounded-full bg-accent transition-transform duration-(--duration-micro)" />
          </span>
          <span className="flex flex-col">
            <span className="text-base text-ink">{o.label}</span>
            {o.description && <span className="text-sm text-muted">{o.description}</span>}
          </span>
        </label>
      ))}
    </div>
  );
}
