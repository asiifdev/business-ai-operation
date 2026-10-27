import { useEffect, useId, useState } from 'react';
import { useT } from '../../lib/use-t';
import { formatNumber, formatRupiah } from '../../lib/format';
import { parseMoney } from '../../lib/money';
import { InputError } from './InputError';
import { mergeDescribedBy, useFieldControl } from './field';
import { TextInput, type TextInputProps } from './TextInput';

interface Props extends Omit<TextInputProps, 'value' | 'defaultValue' | 'onChange' | 'type' | 'inputMode' | 'prefix' | 'suffix'> {
  /** Integer Rupiah, or null when empty. */
  value?: number | null;
  defaultValue?: number | null;
  onChange?: (value: number | null) => void;
  min?: number;
  max?: number;
  /** Form field name; the submitted value is the plain integer (never "Rp 1.500.000"). */
  name?: string;
}

const display = (n: number | null | undefined) => (n === null || n === undefined ? '' : formatNumber(n));

/** Shows "Rp 1.500.000" but holds and submits a plain integer. Accepts shortcuts: 500k, 2rb, 1,5jt (press Enter or leave the field). */
export function MoneyInput({ value, defaultValue, onChange, min, max, name, ...rest }: Props) {
  const t = useT();
  const errorId = useId();
  const field = useFieldControl({ id: rest.id, invalid: rest.error, 'aria-describedby': rest['aria-describedby'] });
  const [text, setText] = useState(display(value ?? defaultValue));
  const [touched, setTouched] = useState(false);
  const parsed = parseMoney(text);
  const amount = parsed.ok ? parsed.value : null;

  useEffect(() => {
    if (value !== undefined && value !== amount) setText(display(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const message =
    touched && text && !parsed.ok ? t(parsed.reason === 'fraction' ? 'moneyFraction' : 'moneyInvalid')
    : amount !== null && min !== undefined && amount < min ? t('moneyMin', { min: formatRupiah(min) })
    : amount !== null && max !== undefined && amount > max ? t('moneyMax', { max: formatRupiah(max) })
    : null;

  const settle = () => {
    setTouched(true);
    if (parsed.ok) setText(display(parsed.value));
  };

  return (
    <>
      <TextInput
        {...rest}
        prefix="Rp"
        inputMode="numeric"
        autoComplete="off"
        value={text}
        error={Boolean(message) || rest.error}
        aria-describedby={mergeDescribedBy(field.describedBy, message ? errorId : undefined)}
        onChange={(e) => {
          const raw = e.currentTarget.value;
          // Plain digits and dots are regrouped live; anything else (500k, 1,5jt) is kept as typed until Enter/blur.
          const next = /^[\d.]*$/.test(raw) ? formatNumber(Number(raw.replace(/\./g, '') || 0)).replace(/^0$/, raw ? '0' : '') : raw;
          setText(raw === '' ? '' : next);
          const p = parseMoney(next);
          onChange?.(p.ok ? p.value : null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { settle(); }
          rest.onKeyDown?.(e);
        }}
        onBlur={(e) => {
          settle();
          rest.onBlur?.(e);
        }}
      />
      {name && <input type="hidden" name={name} value={amount ?? ''} />}
      <InputError id={errorId} messages={message} />
    </>
  );
}
