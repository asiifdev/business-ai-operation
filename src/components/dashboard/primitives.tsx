import type { CSSProperties, ReactNode } from 'react';
import { cx } from '../../lib/cx';
import { Icon } from '../shell/Icon';
import type { IconName } from '../../lib/nav';

/** Staggers the entrance of cards (`.rise` in global.css): each gets a later start by its position. */
export const stagger = (i: number): CSSProperties => ({ '--i': i }) as CSSProperties;

/** A heading with an optional quiet link or note on the right, the way every dashboard section starts. */
export function SectionHeading({ title, aside, intro }: { title: string; aside?: ReactNode; intro?: string }) {
  return (
    <div className="flex items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 className="m-0 text-base font-semibold text-ink">{title}</h2>
        {intro && <p className="mt-0.5 mb-0 text-sm text-muted">{intro}</p>}
      </div>
      {aside}
    </div>
  );
}

/** A link that falls back to plain text while its target page does not exist yet, so nobody reaches a missing page. */
export function MaybeLink({ href, ready = true, className, children }: { href: string; ready?: boolean; className?: string; children: ReactNode }) {
  return ready ? (
    <a href={href} className={className}>
      {children}
    </a>
  ) : (
    <span className={className}>{children}</span>
  );
}

export type Tone = 'neutral' | 'good' | 'bad' | 'warn' | 'accent';

const figure: Record<Tone, string> = { neutral: 'text-ink', good: 'text-success', bad: 'text-danger', warn: 'text-warm-ink', accent: 'text-accent' };

/** One headline figure: a small label, a large monospaced number whose colour says good/bad, and one line of context. */
export function Stat({ label, value, note, tone = 'neutral', index = 0, href, ready = true, icon }: { label: string; value: string; note?: string; tone?: Tone; index?: number; href?: string; ready?: boolean; icon?: IconName }) {
  const body = (
    <>
      <span className="flex items-center justify-between gap-2 text-sm text-muted">
        {label}
        {icon && <Icon name={icon} className="size-4 shrink-0" />}
      </span>
      <span className={cx('mt-2 block font-mono text-lg font-semibold tracking-tight tabular-nums sm:text-2xl', figure[tone])}>{value}</span>
      {note && <span className="mt-1 block text-xs text-muted">{note}</span>}
    </>
  );
  const box = 'rise block h-full rounded-card border border-rule bg-key-face p-4 no-underline';
  return (
    <li style={stagger(index)}>
      {href && ready ? (
        <a href={href} className={cx(box, 'transition-colors duration-200 hover:border-rule-2 hover:bg-paper')}>
          {body}
        </a>
      ) : (
        <div className={box}>{body}</div>
      )}
    </li>
  );
}

/** A small round count, for "3 waiting". Zero never renders as a pill: nothing to count, nothing to show. */
export function CountPill({ n, tone = 'warn' }: { n: number; tone?: 'warn' | 'bad' | 'accent' }) {
  const tones = { warn: 'bg-warm/20 text-warm-ink', bad: 'bg-danger-wash text-danger', accent: 'bg-accent-wash text-accent' };
  return <span className={cx('inline-grid min-w-6 place-items-center rounded-full px-2 py-0.5 font-mono text-xs font-medium tabular-nums', tones[tone])}>{n}</span>;
}
