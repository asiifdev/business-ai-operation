import { useId, useRef, useState } from 'react';
import { useT } from '../../lib/use-t';
import { cx } from '../../lib/cx';
import { formatDate, monthName, parseDisplayDate, weekdayInitials } from '../../lib/format';
import { FloatingPanel } from '../ui/FloatingPanel';
import { InputError } from './InputError';
import { mergeDescribedBy, useFieldControl } from './field';
import { TextInput, type TextInputProps } from './TextInput';
import { useControllable } from './hooks';

interface Props extends Omit<TextInputProps, 'value' | 'defaultValue' | 'onChange' | 'type' | 'inputMode' | 'suffix' | 'prefix'> {
  /** ISO date "YYYY-MM-DD" or "" when empty. This is also what a form submits. */
  value?: string;
  defaultValue?: string;
  onChange?: (iso: string) => void;
  min?: string;
  max?: string;
  name?: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
const todayIso = () => { const n = new Date(); return iso(n.getFullYear(), n.getMonth(), n.getDate()); };
const addDays = (isoDate: string, days: number) => {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return iso(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate());
};
const mask = (raw: string) => {
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  return [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4)].filter(Boolean).join('/');
};

export function DateInput({ value, defaultValue = '', onChange, min, max, name, ...rest }: Props) {
  const t = useT();
  const errorId = useId();
  const field = useFieldControl({ id: rest.id, invalid: rest.error, 'aria-describedby': rest['aria-describedby'] });
  const [date, setDate] = useControllable(value, defaultValue, onChange);
  const [text, setText] = useState(formatDate(date));
  const [touched, setTouched] = useState(false);
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  const outOfRange = (d: string) => (min && d < min ? t('dateMin', { min: formatDate(min) }) : max && d > max ? t('dateMax', { max: formatDate(max) }) : null);

  const parsed = parseDisplayDate(text);
  const message = text && touched && !parsed ? t('dateInvalid') : parsed ? outOfRange(parsed) : null;

  const pick = (next: string) => {
    setDate(next);
    setText(formatDate(next));
    setTouched(true);
  };

  return (
    <div ref={anchor}>
      <TextInput
        {...rest}
        inputMode="numeric"
        placeholder="DD/MM/YYYY"
        autoComplete="off"
        value={text}
        error={Boolean(message) || rest.error}
        aria-describedby={mergeDescribedBy(field.describedBy, message ? errorId : undefined)}
        onChange={(e) => {
          const next = mask(e.currentTarget.value);
          setText(next);
          const p = parseDisplayDate(next);
          setDate(p && !outOfRange(p) ? p : '');
        }}
        onBlur={(e) => { setTouched(true); rest.onBlur?.(e); }}
        suffix={
          <button
            type="button"
            aria-label={t('openCalendar')}
            aria-haspopup="dialog"
            aria-expanded={open}
            disabled={rest.disabled}
            onClick={() => setOpen((v) => !v)}
            className="inline-flex size-6 items-center justify-center rounded text-muted transition-colors duration-(--duration-micro) hover:bg-paper-3 hover:text-ink disabled:cursor-not-allowed"
          >
            <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="2" y="3" width="12" height="11" rx="1.5" /><path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" strokeLinecap="round" />
            </svg>
          </button>
        }
      />
      {name && <input type="hidden" name={name} value={date} />}
      <InputError id={errorId} messages={message} />
      <FloatingPanel anchorRef={anchor} open={open} onClose={() => setOpen(false)} className="p-3">
        <Calendar
          selected={date}
          min={min}
          max={max}
          onPick={(d) => { pick(d); setOpen(false); }}
          onEscape={() => setOpen(false)}
        />
      </FloatingPanel>
    </div>
  );
}

function Calendar({ selected, min, max, onPick, onEscape }: { selected: string; min?: string; max?: string; onPick: (d: string) => void; onEscape: () => void }) {
  const t = useT();
  const start = selected || todayIso();
  const [focus, setFocus] = useState(start);
  const [y, m] = focus.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const lead = (first.getUTCDay() + 6) % 7; // week starts Monday
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells = Array.from({ length: 42 }, (_, i) => (i < lead || i >= lead + days ? null : i - lead + 1));
  const today = todayIso();
  const gridRef = useRef<HTMLDivElement>(null);

  const move = (to: string) => {
    setFocus(to);
    requestAnimationFrame(() => gridRef.current?.querySelector<HTMLButtonElement>(`[data-date="${to}"]`)?.focus());
  };
  const shiftMonth = (delta: number) => {
    const dt = new Date(Date.UTC(y, m - 1 + delta, 1));
    setFocus(iso(dt.getUTCFullYear(), dt.getUTCMonth(), 1));
  };
  const onKey = (e: React.KeyboardEvent) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (step) { e.preventDefault(); move(addDays(focus, step)); }
    if (e.key === 'Escape') { e.preventDefault(); onEscape(); }
  };

  return (
    <div role="dialog" aria-label={`${monthName(m - 1)} ${y}`} onKeyDown={onKey} className="w-64">
      <div className="mb-2 flex items-center justify-between">
        <button type="button" aria-label={t('previousMonth')} onClick={() => shiftMonth(-1)} className="rounded px-2 py-1 text-ink hover:bg-paper-3">‹</button>
        <span className="font-display text-sm font-medium text-ink" aria-live="polite">{monthName(m - 1)} {y}</span>
        <button type="button" aria-label={t('nextMonth')} onClick={() => shiftMonth(1)} className="rounded px-2 py-1 text-ink hover:bg-paper-3">›</button>
      </div>
      <div ref={gridRef} className="grid grid-cols-7 gap-0.5 text-center text-sm">
        {weekdayInitials().map((d, i) => <span key={i} className="py-1 text-xs text-muted">{d}</span>)}
        {cells.map((d, i) => {
          if (d === null) return <span key={i} />;
          const value = iso(y, m - 1, d);
          const disabled = Boolean((min && value < min) || (max && value > max));
          return (
            <button
              key={i}
              type="button"
              data-date={value}
              disabled={disabled}
              tabIndex={value === focus ? 0 : -1}
              aria-pressed={value === selected}
              aria-current={value === today ? 'date' : undefined}
              onClick={() => onPick(value)}
              className={cx(
                'rounded py-1.5 tabular-nums transition-colors duration-(--duration-micro) disabled:cursor-not-allowed disabled:text-muted disabled:opacity-40',
                value === selected ? 'bg-accent text-accent-ink' : 'text-ink hover:bg-paper-3',
                value === today && value !== selected && 'border border-rule-2',
              )}
            >
              {d}
            </button>
          );
        })}
      </div>
    </div>
  );
}
