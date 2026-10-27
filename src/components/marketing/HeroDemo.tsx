import { useState } from 'react';
import { LogoMark } from '../brand/LogoMark';
import type { ExplorerText } from './HowItWorks';

interface Props {
  text: ExplorerText;
  pauseLabel: string;
  playLabel: string;
  org: string;
  appName: string;
}

const RAIL = [
  'M4 6h16M4 12h16M4 18h10', // list
  'M12 3v18M3 12h18', // plus
  'M5 13l4 4L19 7', // check
  'M12 4v8l5 3', // clock
];

/**
 * Hero banner: a looping walkthrough of one finding (finding, AI draft typing, approval, audit line). It is CSS-only
 * animation, so it is in the HTML from the start and needs no JavaScript to read; the island only adds Pause.
 * Sample data, labelled as such (BR-M16-05). With reduced motion it shows the finished state.
 */
export function HeroDemo({ text, pauseLabel, playLabel, org, appName }: Props) {
  const [paused, setPaused] = useState(false);
  const L = text.labels;

  return (
    <figure className="m-0">
      <div className="hero-demo relative mx-auto w-full max-w-xl" data-paused={paused}>
        <div aria-hidden="true" className="rounded-[1.25rem] bg-paper-2 p-3 shadow-pop sm:p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 font-display text-sm font-semibold text-ink">
              <LogoMark size={20} />
              {appName}
            </span>
            <span className="rounded-full bg-paper-3 px-2.5 py-0.5 text-xs text-ink-2">{org}</span>
          </div>
          <div className="grid grid-cols-[2.6rem_minmax(0,1fr)] gap-3">
            <div className="flex flex-col items-center gap-2 rounded-input bg-paper p-1.5">
              {RAIL.map((d, i) => (
                <span key={d} className={`grid size-8 place-items-center rounded-lg ${i === 1 ? 'bg-accent-wash text-accent' : 'text-muted'}`}>
                  <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
                </span>
              ))}
            </div>
            <div className="min-w-0 space-y-2.5">
              <div className="demo-finding rounded-input bg-paper p-3">
                <p className="m-0 flex items-center justify-between gap-2 text-sm font-medium text-ink">
                  {L.finding}
                  <span className="rounded-full bg-danger-wash px-2 py-0.5 text-xs font-medium text-danger">{text.sample.late}d</span>
                </p>
                <p className="mt-1 mb-0 font-mono text-xs text-ink-2">{text.sample.invoice} · {text.sample.client} · {text.sample.amount}</p>
              </div>
              <div className="demo-draft rounded-input bg-paper p-3">
                <p className="m-0 text-xs font-medium text-muted">{L.draft}</p>
                <p className="demo-type mt-1 mb-0 text-sm text-ink-2">{text.sample.draft}</p>
              </div>
              <div className="demo-actions flex flex-wrap items-center gap-2 rounded-input bg-paper p-3">
                <span className="demo-approve rounded-full bg-accent px-4 py-1.5 font-display text-sm font-medium text-accent-ink">{L.approve}</span>
                <span className="rounded-full border border-rule-2 px-4 py-1.5 font-display text-sm text-ink">{L.reject}</span>
                <span className="demo-approved ml-auto rounded-full bg-accent-wash px-3 py-1 text-xs font-medium text-success">✓ {L.approve}</span>
              </div>
              <div className="demo-audit rounded-input bg-paper p-3">
                <p className="m-0 text-xs font-medium text-muted">{L.audit}</p>
                <p className="mt-1 mb-0 text-xs text-ink-2">{text.sample.audit}</p>
              </div>
            </div>
          </div>
        </div>

        <div aria-hidden="true" className="demo-telegram absolute -bottom-5 -left-2 hidden w-60 rounded-card bg-paper-3 p-3 shadow-pop sm:block lg:-left-8">
          <p className="m-0 text-xs text-ink-2">{L.finding}<br /><span className="font-mono">{text.sample.invoice}</span></p>
          <p className="mt-2 mb-0 flex gap-2"><span className="rounded-md bg-paper px-2 py-1 text-xs text-ink">{L.approve}</span><span className="rounded-md bg-paper px-2 py-1 text-xs text-ink">{L.reject}</span></p>
        </div>
      </div>

      <figcaption className="mx-auto mt-8 flex max-w-xl flex-wrap items-center justify-between gap-3 text-xs text-muted">
        <span>{text.note}</span>
        <button type="button" onClick={() => setPaused((p) => !p)} aria-pressed={paused} className="cursor-pointer rounded-full border border-rule-2 bg-transparent px-3 py-1 font-display text-xs text-ink-2 hover:text-ink motion-reduce:hidden">
          {paused ? playLabel : pauseLabel}
        </button>
      </figcaption>
    </figure>
  );
}
