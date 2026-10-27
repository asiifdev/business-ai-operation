import { useState } from 'react';
import { cx } from '../../lib/cx';

export interface ExplorerText {
  title: string;
  note: string;
  stepWord: string;
  steps: readonly string[];
  labels: Record<'finding' | 'invoice' | 'client' | 'amount' | 'late' | 'draft' | 'approve' | 'reject' | 'waiting' | 'rejected' | 'audit' | 'startOver' | 'hintDecide' | 'sampleBadge', string>;
  sample: Record<'invoice' | 'client' | 'amount' | 'late' | 'draft' | 'action' | 'audit', string>;
}

interface Props {
  stages: readonly { title: string; body: string }[];
  text: ExplorerText;
  heading: string;
  intro: string;
}

type Decision = 'pending' | 'approved' | 'rejected';

const ICONS = [
  'M4 7c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zm0 5c0 1.7 3.6 3 8 3s8-1.3 8-3M4 17c0 1.7 3.6 3 8 3s8-1.3 8-3', // data
  'M12 3a6 6 0 0 0-6 6c0 4-2 5-2 5h16s-2-1-2-5a6 6 0 0 0-6-6zm-2 14a2 2 0 0 0 4 0', // rule / bell
  'M12 3l1.8 4.7L18.5 9l-4.7 1.8L12 15.5l-1.8-4.7L5.5 9l4.7-1.3zM18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8z', // sparkles
  'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zm-3 9l2.2 2.2L15.5 10', // shield check
];

const NODES = [{ x: 50, y: 15 }, { x: 85, y: 50 }, { x: 50, y: 85 }, { x: 15, y: 50 }];
const RADIUS = 35;
const CIRC = 2 * Math.PI * RADIUS;

/**
 * "How it works": four step cards (all text visible in the HTML) that select a step; below them a live sample card
 * where the visitor can approve or reject the proposed action. Sample data, labelled as such.
 */
export function HowItWorks({ stages, text, heading, intro }: Props) {
  const [active, setActive] = useState(0);
  const [decision, setDecision] = useState<Decision>('pending');
  const L = text.labels;
  const closed = decision === 'approved' && active === 3;
  const progress = closed ? CIRC : (CIRC * active) / 4;

  const approve = () => {
    setDecision('approved');
    setActive(3);
  };
  const startOver = () => {
    setDecision('pending');
    setActive(0);
  };

  return (
    <section className="wrap py-16" aria-labelledby="how-heading">
      <h2 id="how-heading" className="m-0 font-display text-3xl font-semibold text-ink sm:text-4xl">{heading}</h2>
      <p className="mt-3 mb-10 max-w-2xl text-lg text-ink-2">{intro}</p>

      <ol className="m-0 grid list-none gap-4 p-0 sm:grid-cols-2 lg:grid-cols-4">
        {stages.map((s, i) => {
          const on = i === active;
          return (
            <li key={s.title} className={cx('group relative rounded-card p-5 transition-colors duration-(--duration-micro) motion-reduce:transition-none', on ? 'bg-paper-3' : 'bg-paper-2 hover:bg-paper-3')}>
              <button type="button" onClick={() => setActive(i)} aria-current={on ? 'step' : undefined} className="m-0 flex w-full cursor-pointer items-center gap-3 border-0 bg-transparent p-0 text-left">
                <span className={cx('grid size-10 shrink-0 place-items-center rounded-xl transition-colors duration-(--duration-micro) motion-reduce:transition-none', on ? 'bg-(--color-brand-node) text-accent-ink' : 'bg-accent-wash text-accent')}>
                  <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ICONS[i]} /></svg>
                </span>
                <span className="font-display text-base font-semibold leading-snug text-ink"><span className="mr-1 text-muted">{i + 1}.</span>{s.title}</span>
              </button>
              <p className="mt-3 mb-0 text-sm leading-relaxed text-ink-2">{s.body}</p>
            </li>
          );
        })}
      </ol>

      <div className="mt-6 grid items-center gap-8 rounded-card bg-paper-2 p-5 sm:p-8 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] lg:gap-12">
        <div className="relative mx-auto aspect-square w-full max-w-[18rem]">
          <svg viewBox="0 0 100 100" aria-hidden="true" className="absolute inset-0 size-full" focusable="false">
            <circle cx="50" cy="50" r={RADIUS} fill="none" stroke="var(--color-paper-3)" strokeWidth="5" />
            <circle cx="50" cy="50" r={RADIUS} fill="none" stroke="var(--color-brand-ring)" strokeWidth="5" strokeLinecap="round" strokeDasharray={`${progress} ${CIRC}`} transform="rotate(-90 50 50)" className="transition-[stroke-dasharray] duration-500 ease-(--ease-out) motion-reduce:transition-none" />
            <circle cx="50" cy="50" r="8" fill="var(--color-brand-node)" opacity={closed ? 1 : 0.55} className="transition-opacity duration-300 motion-reduce:transition-none" />
          </svg>
          {NODES.map((n, i) => (
            <button key={text.steps[i]} type="button" onClick={() => setActive(i)} aria-label={`${text.stepWord} ${i + 1}: ${text.steps[i]}`} style={{ left: `${n.x}%`, top: `${n.y}%` }} className={cx('absolute grid size-11 -translate-x-1/2 -translate-y-1/2 cursor-pointer place-items-center rounded-full border-0 font-display text-sm font-semibold transition-[background-color,transform] duration-(--duration-micro) hover:scale-105 active:scale-95 motion-reduce:transition-none', i === active ? 'bg-(--color-brand-node) text-accent-ink' : i < active || closed ? 'bg-accent-wash text-ink' : 'bg-paper-3 text-ink-2')}>{i + 1}</button>
          ))}
        </div>

        <div>
          <p className="m-0 flex items-center justify-between gap-2 font-display text-base font-semibold text-ink">
            {text.title}
            <span className="rounded-full bg-paper-3 px-2.5 py-0.5 text-xs font-medium text-ink-2">{L.sampleBadge}</span>
          </p>
          <p className="mt-1 mb-4 text-xs text-muted">{text.note}</p>
          <div className="space-y-3">
            <div className="rounded-input bg-paper p-4">
              <p className="m-0 text-sm font-medium text-ink">{L.finding}</p>
              <dl className="m-0 mt-2 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
                <dt className="text-muted">{L.invoice}</dt><dd className="m-0 font-mono text-ink">{text.sample.invoice}</dd>
                <dt className="text-muted">{L.client}</dt><dd className="m-0 text-ink">{text.sample.client}</dd>
                <dt className="text-muted">{L.amount}</dt><dd className="m-0 font-mono text-ink">{text.sample.amount}</dd>
                <dt className="text-muted">{L.late}</dt><dd className="m-0 font-mono text-ink">{text.sample.late}</dd>
              </dl>
            </div>
            {active >= 1 && (
              <div className="rounded-input bg-paper p-4">
                <p className="m-0 text-xs font-medium text-muted">{L.draft}</p>
                <p className="mt-1 mb-0 text-sm text-ink-2">{text.sample.draft}</p>
              </div>
            )}
            {active >= 2 && decision === 'pending' && (
              <div className="rounded-input bg-paper p-4">
                <p className="m-0 text-sm text-ink">{text.sample.action}</p>
                <p className="mt-1 mb-3 text-xs text-muted">{L.hintDecide}</p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={approve} className="cursor-pointer rounded-full border-0 bg-accent px-5 py-2 font-display text-sm font-medium text-accent-ink transition-transform duration-(--duration-micro) hover:-translate-y-px active:translate-y-0 motion-reduce:transition-none">{L.approve}</button>
                  <button type="button" onClick={() => setDecision('rejected')} className="cursor-pointer rounded-full border border-rule-2 bg-transparent px-5 py-2 font-display text-sm font-medium text-ink transition-colors duration-(--duration-micro) hover:bg-paper-3 motion-reduce:transition-none">{L.reject}</button>
                </div>
              </div>
            )}
            {decision === 'rejected' && active >= 2 && (
              <div className="rounded-input bg-paper p-4" role="status">
                <p className="m-0 text-sm text-ink">{L.rejected}</p>
                <button type="button" onClick={startOver} className="mt-2 cursor-pointer border-0 bg-transparent p-0 text-sm text-accent underline underline-offset-4">{L.startOver}</button>
              </div>
            )}
            {decision === 'approved' && active >= 3 && (
              <div className="rounded-input bg-paper p-4" role="status">
                <p className="m-0 text-xs font-medium text-muted">{L.audit}</p>
                <p className="mt-1 mb-0 text-xs text-ink-2">{text.sample.audit}</p>
                <button type="button" onClick={startOver} className="mt-2 cursor-pointer border-0 bg-transparent p-0 text-sm text-accent underline underline-offset-4">{L.startOver}</button>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
