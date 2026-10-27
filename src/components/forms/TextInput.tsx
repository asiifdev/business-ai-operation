import { useRef, useState, type ComponentPropsWithRef, type ReactNode } from 'react';
import { useT } from '../../lib/use-t';
import { cx } from '../../lib/cx';
import { useFieldControl } from './field';
import { addon, bareInput, controlShell, controlSize } from './styles';

export interface TextInputProps extends Omit<ComponentPropsWithRef<'input'>, 'size' | 'prefix' | 'type'> {
  type?: 'text' | 'email' | 'password' | 'search' | 'tel' | 'url';
  size?: 'md' | 'sm';
  prefix?: ReactNode;
  suffix?: ReactNode;
  icon?: ReactNode;
  clearable?: boolean;
  error?: boolean;
  valid?: boolean;
  /** Class for the outer shell (the visible box). */
  shellClassName?: string;
}

export function TextInput({
  size = 'md', prefix, suffix, icon, clearable = false, error, valid, disabled, className, shellClassName,
  type = 'text', onChange, ref, ...rest
}: TextInputProps) {
  const t = useT();
  const field = useFieldControl({ id: rest.id, invalid: error, required: rest.required, 'aria-describedby': rest['aria-describedby'] });
  const inner = useRef<HTMLInputElement | null>(null);
  const [filled, setFilled] = useState(Boolean(rest.value ?? rest.defaultValue));
  const hasValue = rest.value !== undefined ? String(rest.value).length > 0 : filled;

  const clear = () => {
    const el = inner.current;
    if (!el) return;
    // Use the native setter so React onChange fires in controlled and uncontrolled use.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(el, '');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.focus();
  };

  return (
    <div
      data-invalid={field.invalid || undefined}
      data-valid={(!field.invalid && valid) || undefined}
      data-disabled={disabled || undefined}
      className={cx(controlShell, controlSize[size], shellClassName)}
    >
      {icon && <span aria-hidden="true" className={addon}>{icon}</span>}
      {prefix && <span className={addon}>{prefix}</span>}
      <input
        {...rest}
        ref={(el) => {
          inner.current = el;
          if (typeof ref === 'function') ref(el);
          else if (ref) ref.current = el;
        }}
        id={field.id}
        type={type}
        disabled={disabled}
        required={field.required || undefined}
        aria-invalid={field.invalid || undefined}
        aria-describedby={field.describedBy}
        onChange={(e) => {
          setFilled(e.currentTarget.value.length > 0);
          onChange?.(e);
        }}
        className={cx(bareInput, className)}
      />
      {clearable && hasValue && !disabled && (
        <button
          type="button"
          aria-label={t('clear')}
          onClick={clear}
          className="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-muted transition-colors duration-(--duration-micro) hover:bg-paper-3 hover:text-ink"
        >
          <svg aria-hidden="true" viewBox="0 0 16 16" className="size-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      )}
      {suffix && <span className={addon}>{suffix}</span>}
    </div>
  );
}
