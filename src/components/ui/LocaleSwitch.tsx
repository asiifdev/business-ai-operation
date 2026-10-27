import { cx } from '../../lib/cx';
import { setLocale, type Locale } from '../../lib/i18n';
import { useLocale, useT } from '../../lib/use-t';

const options: ReadonlyArray<{ value: Locale; label: string }> = [
  { value: 'id', label: 'ID' },
  { value: 'en', label: 'EN' },
];

/** Switches the UI language between Indonesian and English. The choice is remembered. */
export function LocaleSwitch() {
  const current = useLocale();
  const t = useT();
  return (
    <div role="group" aria-label={t('language')} className="inline-flex gap-0.5 rounded-input border border-rule bg-paper-3 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={current === o.value}
          onClick={() => setLocale(o.value)}
          className={cx(
            'min-h-7 rounded px-2.5 font-display text-sm font-medium transition-[background-color,color,box-shadow] duration-(--duration-micro)',
            current === o.value ? 'bg-paper text-ink shadow-card' : 'text-ink-2 hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
