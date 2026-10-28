import type { ReactNode } from 'react';
import { cx } from '../../lib/cx';

type Tone = 'neutral' | 'success' | 'warn' | 'danger' | 'accent';

const tones: Record<Tone, string> = {
  neutral: 'border-rule-2 text-muted',
  success: 'border-success text-success',
  warn: 'border-warm text-warm-ink',
  danger: 'border-danger text-danger',
  accent: 'border-accent text-accent',
};

/** A small outlined text label for a state ("Behind", "Archived"). Colour is never the only signal: the text says it. */
export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cx('inline-block rounded-full border px-2 py-0.5 text-xs whitespace-nowrap', tones[tone], className)}>{children}</span>;
}
