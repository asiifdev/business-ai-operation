import { useId, useState, type ReactNode } from 'react';
import { useT } from '../../lib/use-t';
import { cx } from '../../lib/cx';
import { FieldContext } from './field';
import { InputError } from './InputError';

interface Props {
  label: string;
  /** Always-visible explanation under the control, in business language. */
  help?: ReactNode;
  /** Longer explanation behind a "?" button. */
  tip?: ReactNode;
  required?: boolean;
  error?: string | readonly string[] | null;
  /** Show "(optional)" next to labels of fields that are not required. */
  showOptional?: boolean;
  id?: string;
  className?: string;
  children: ReactNode;
}

export function FormField({ label, help, tip, required = false, error, showOptional = false, id, className, children }: Props) {
  const t = useT();
  const auto = useId();
  const base = id ?? auto;
  const labelId = `${base}-label`;
  const helpId = `${base}-help`;
  const tipId = `${base}-tip`;
  const errorId = `${base}-error`;
  const [tipOpen, setTipOpen] = useState(false);
  const hasError = Array.isArray(error) ? error.length > 0 : Boolean(error);
  const describedBy = [hasError && errorId, help && helpId, tip && tipOpen && tipId].filter(Boolean).join(' ') || undefined;

  return (
    <FieldContext.Provider value={{ id: base, labelId, describedBy, invalid: hasError, required }}>
      <div className={cx('flex flex-col gap-1.5', className)}>
        <div className="flex items-center gap-1.5">
          <label id={labelId} htmlFor={base} className="font-display text-sm font-medium text-ink">
            {label}
            {required && (
              <>
                <span aria-hidden="true" className="ml-0.5 text-danger">*</span>
                <span className="sr-only"> ({t('required')})</span>
              </>
            )}
            {!required && showOptional && <span className="ml-1 font-body font-normal text-muted">({t('optional')})</span>}
          </label>
          {tip && (
            <button
              type="button"
              aria-expanded={tipOpen}
              aria-controls={tipId}
              aria-label={t('showHelp')}
              onClick={() => setTipOpen((v) => !v)}
              className="inline-flex size-5 items-center justify-center rounded-full border border-rule-2 text-xs text-muted transition-colors duration-(--duration-micro) hover:border-accent hover:text-accent"
            >
              ?
            </button>
          )}
        </div>
        {children}
        <InputError id={errorId} messages={error} />
        {help && (
          <p id={helpId} className="m-0 text-sm text-muted">
            {help}
          </p>
        )}
        {tip && tipOpen && (
          <div id={tipId} className="rounded-input border border-rule bg-paper-2 p-3 text-sm text-ink-2">
            {tip}
          </div>
        )}
      </div>
    </FieldContext.Provider>
  );
}
