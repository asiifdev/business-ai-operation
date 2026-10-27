import { useState } from 'react';
import { cx } from '../../lib/cx';

interface Props {
  annualLabel: string;
  monthlyLabel: string;
  /** CSS selector of the element carrying data-billing. */
  target: string;
}

/** Annual / monthly switch. Both prices are always in the HTML; the switch only chooses which one is shown. */
export function BillingToggle({ annualLabel, monthlyLabel, target }: Props) {
  const [mode, setMode] = useState<'annual' | 'monthly'>('annual');

  const choose = (next: 'annual' | 'monthly') => {
    setMode(next);
    const el = document.querySelector<HTMLElement>(target);
    if (el) el.dataset.billing = next;
  };

  const base = 'cursor-pointer rounded-full border-0 px-4 py-1.5 font-display text-sm font-medium transition-colors duration-(--duration-micro) motion-reduce:transition-none';
  return (
    <div role="group" aria-label={`${annualLabel} / ${monthlyLabel}`} className="inline-flex gap-1 rounded-full bg-paper-3 p-1">
      {(['annual', 'monthly'] as const).map((m) => (
        <button key={m} type="button" aria-pressed={mode === m} onClick={() => choose(m)} className={cx(base, mode === m ? 'bg-paper text-ink shadow-card' : 'bg-transparent text-ink-2 hover:text-ink')}>
          {m === 'annual' ? annualLabel : monthlyLabel}
        </button>
      ))}
    </div>
  );
}
