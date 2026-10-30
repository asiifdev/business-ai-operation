import { useLayoutEffect, useRef, useState, type ComponentPropsWithRef, type ReactNode } from 'react';
import { useT } from '../../lib/use-t';
import { cx } from '../../lib/cx';
import { useFieldControl } from './field';
import { controlShell } from './styles';

interface Props extends Omit<ComponentPropsWithRef<'textarea'>, 'rows'> {
  rows?: number;
  /** Maximum auto-grown height in px. */
  maxHeight?: number;
  /** Show "n / maxLength" (needs maxLength). */
  counter?: boolean;
  error?: boolean;
  valid?: boolean;
  /** A row of actions inside the box, under the text (a chat composer's send button). */
  footer?: ReactNode;
}

export function Textarea({ rows = 3, maxHeight = 480, counter = false, error, valid, disabled, className, onChange, ref, footer, ...rest }: Props) {
  const t = useT();
  const field = useFieldControl({ id: rest.id, invalid: error, required: rest.required, 'aria-describedby': rest['aria-describedby'] });
  const el = useRef<HTMLTextAreaElement | null>(null);
  const [length, setLength] = useState(String(rest.value ?? rest.defaultValue ?? '').length);
  const shown = rest.value !== undefined ? String(rest.value).length : length;

  useLayoutEffect(() => {
    const node = el.current;
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${Math.min(node.scrollHeight, maxHeight)}px`;
    node.style.overflowY = node.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, [shown, maxHeight]);

  return (
    <div>
      <div data-invalid={field.invalid || undefined} data-valid={(!field.invalid && valid) || undefined} data-disabled={disabled || undefined} className={cx(controlShell, 'items-stretch px-3 py-2', footer != null && 'flex-col')}>
        <textarea
          {...rest}
          ref={(node) => {
            el.current = node;
            if (typeof ref === 'function') ref(node);
            else if (ref) ref.current = node;
          }}
          id={field.id}
          rows={rows}
          disabled={disabled}
          required={field.required || undefined}
          aria-invalid={field.invalid || undefined}
          aria-describedby={field.describedBy}
          onChange={(e) => { setLength(e.currentTarget.value.length); onChange?.(e); }}
          className={cx('min-w-0 flex-1 resize-none bg-transparent text-base text-ink outline-none placeholder:text-muted disabled:cursor-not-allowed', className)}
        />
        {footer != null && <div className="flex items-center gap-2">{footer}</div>}
      </div>
      {counter && rest.maxLength !== undefined && (
        <p aria-label={`${shown} / ${rest.maxLength} ${t('characters')}`} className={cx('mt-1 text-right text-xs tabular-nums', shown >= rest.maxLength ? 'text-danger' : 'text-muted')}>
          {shown} / {rest.maxLength}
        </p>
      )}
    </div>
  );
}
