import { useEffect, useId, useState } from 'react';
import { useT } from '../../lib/use-t';
import { formatNumber } from '../../lib/format';
import { InputError } from './InputError';
import { mergeDescribedBy, useFieldControl } from './field';
import { TextInput, type TextInputProps } from './TextInput';

interface Props extends Omit<TextInputProps, 'value' | 'defaultValue' | 'onChange' | 'type' | 'inputMode'> {
  value?: number | null;
  defaultValue?: number | null;
  onChange?: (value: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  name?: string;
}

const toText = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n).replace('.', ','));
const toNumber = (s: string): number | null => {
  const n = Number(s.replace(',', '.'));
  return s === '' || s === '-' || Number.isNaN(n) ? null : n;
};

/** Numeric text field: rejects letters, steps with arrow keys, clamps on blur. Never a raw type=number. */
export function NumberInput({ value, defaultValue, onChange, min, max, step = 1, name, ...rest }: Props) {
  const t = useT();
  const errorId = useId();
  const field = useFieldControl({ id: rest.id, invalid: rest.error, 'aria-describedby': rest['aria-describedby'] });
  const allowDecimal = !Number.isInteger(step);
  const allowNegative = min === undefined || min < 0;
  const [text, setText] = useState(toText(value ?? defaultValue));

  useEffect(() => {
    if (value !== undefined && value !== toNumber(text)) setText(toText(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const current = toNumber(text);
  const message =
    current !== null && min !== undefined && current < min ? t('numberMin', { min: formatNumber(min) })
    : current !== null && max !== undefined && current > max ? t('numberMax', { max: formatNumber(max) })
    : null;

  const commit = (next: string) => {
    setText(next);
    onChange?.(toNumber(next));
  };

  const pattern = new RegExp(`^${allowNegative ? '-?' : ''}\\d*${allowDecimal ? '[.,]?\\d*' : ''}$`);

  const stepBy = (dir: 1 | -1) => {
    const base = current ?? 0;
    let next = Math.round((base + dir * step) * 1e9) / 1e9;
    if (min !== undefined) next = Math.max(min, next);
    if (max !== undefined) next = Math.min(max, next);
    commit(toText(next));
  };

  return (
    <>
      <TextInput
        {...rest}
        inputMode={allowDecimal ? 'decimal' : 'numeric'}
        value={text}
        error={Boolean(message) || rest.error}
        aria-describedby={mergeDescribedBy(field.describedBy, message ? errorId : undefined)}
        onChange={(e) => {
          const next = e.currentTarget.value;
          if (pattern.test(next)) commit(next);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp') { e.preventDefault(); stepBy(1); }
          if (e.key === 'ArrowDown') { e.preventDefault(); stepBy(-1); }
          rest.onKeyDown?.(e);
        }}
        onBlur={(e) => {
          const n = toNumber(text);
          if (n !== null) {
            let clamped = n;
            if (min !== undefined) clamped = Math.max(min, clamped);
            if (max !== undefined) clamped = Math.min(max, clamped);
            if (clamped !== n) commit(toText(clamped));
          }
          rest.onBlur?.(e);
        }}
      />
      {name && <input type="hidden" name={name} value={current ?? ''} />}
      <InputError id={errorId} messages={message} />
    </>
  );
}
