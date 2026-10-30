import type { ReactNode } from 'react';
import { cx } from '../../lib/cx';
import { useT } from '../../lib/use-t';

export type StepStatus = 'done' | 'current' | 'upcoming' | 'failed' | 'skipped';

export interface StepItem {
  /** Stable key; also what `onSelect` receives. */
  id: string;
  label: ReactNode;
  /** One line under the label: when it happened, what it waits for, why it failed. */
  note?: ReactNode;
  status: StepStatus;
}

const STATUS_KEY = { done: 'stepDone', current: 'stepCurrent', upcoming: 'stepUpcoming', failed: 'stepFailed', skipped: 'stepSkipped' } as const;

const MARK: Record<StepStatus, string> = {
  done: 'border-accent bg-accent text-accent-ink',
  current: 'border-accent bg-key-face text-accent ring-4 ring-accent/15',
  upcoming: 'border-rule-2 bg-key-face text-muted',
  failed: 'border-danger bg-danger text-paper',
  skipped: 'border-rule-2 bg-paper-2 text-muted',
};

function Mark({ status, n }: { status: StepStatus; n: number }) {
  return (
    <span aria-hidden="true" className={cx('relative z-10 grid size-7 shrink-0 place-items-center rounded-full border-2 font-mono text-xs font-semibold transition-colors duration-(--duration-micro)', MARK[status])}>
      {status === 'done' ? (
        <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
      ) : status === 'failed' ? (
        <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M7 7l10 10M17 7 7 17" /></svg>
      ) : status === 'current' ? (
        <span className="steps-pulse size-2.5 rounded-full bg-accent" />
      ) : (
        n
      )}
    </span>
  );
}

/**
 * Where a process stands: what is done, what runs now, what comes next and what failed. The state is always written out
 * for screen readers and shown by the mark's shape (check, cross, dot, number), never by colour alone. Statuses come from
 * the data (a run's steps, an invoice's status), never from a guess about progress.
 */
export function Steps({ steps, label, orientation = 'vertical', selected, onSelect, className }: {
  steps: readonly StepItem[];
  /** Names the list for assistive technology ("Setup steps"). */
  label: string;
  orientation?: 'vertical' | 'horizontal';
  /** With `onSelect`, every step is a button and this one is pressed. */
  selected?: string | null;
  onSelect?: (id: string) => void;
  className?: string;
}) {
  const t = useT();
  const horizontal = orientation === 'horizontal';
  return (
    <ol aria-label={label} className={cx('m-0 list-none p-0', horizontal ? 'flex items-start' : 'flex flex-col', className)}>
      {steps.map((step, i) => {
        const last = i === steps.length - 1;
        const linkDone = step.status === 'done';
        const body = (
          <>
            <Mark status={step.status} n={i + 1} />
            <span className={cx('flex min-w-0 flex-col', horizontal ? 'items-center text-center' : 'pt-0.5')}>
              <span className={cx('text-sm [overflow-wrap:anywhere]', step.status === 'current' || step.status === 'failed' ? 'font-semibold text-ink' : step.status === 'upcoming' || step.status === 'skipped' ? 'text-muted' : 'text-ink')}>{step.label}</span>
              <span className="sr-only">{t(STATUS_KEY[step.status])}</span>
              {step.note && <span className={cx('text-xs [overflow-wrap:anywhere]', step.status === 'failed' ? 'text-danger' : 'text-muted')}>{step.note}</span>}
            </span>
          </>
        );
        const inner = horizontal ? 'flex flex-col items-center gap-1.5 px-1' : 'flex items-start gap-3';
        return (
          <li key={step.id} aria-current={step.status === 'current' ? 'step' : undefined} className={cx('relative min-w-0', horizontal ? 'flex-1' : !last && 'pb-4')}>
            {!last && (
              <span
                aria-hidden="true"
                className={cx('absolute', horizontal ? 'top-3.5 left-[calc(50%+1rem)] right-[calc(-50%+1rem)] h-0.5' : 'top-8 bottom-1 left-3.5 w-0.5 -translate-x-1/2', 'rounded-full', linkDone ? 'bg-accent' : 'bg-rule')}
              />
            )}
            {onSelect ? (
              <button
                type="button"
                onClick={() => onSelect(step.id)}
                aria-pressed={selected === step.id}
                className={cx(inner, 'w-full rounded-input text-left transition-colors duration-(--duration-micro) hover:bg-paper-2 active:bg-paper-3', !horizontal && '-mx-1.5 px-1.5 py-1', selected === step.id && 'bg-accent-wash hover:bg-accent-wash')}
              >
                {body}
              </button>
            ) : (
              <div className={inner}>{body}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
