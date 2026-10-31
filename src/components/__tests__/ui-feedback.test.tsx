import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { messages } from '../../lib/i18n';
import { Modal } from '../ui/Modal';
import { Steps, type StepItem } from '../ui/Steps';
import { ErrorBoundary } from '../ui/ErrorBoundary';
import { Toaster } from '../ui/Toast';

const steps: StepItem[] = [
  { id: 'repo', label: 'Clone', status: 'done' },
  { id: 'build', label: 'Build', status: 'failed', note: 'exit 1' },
  { id: 'run', label: 'Start', status: 'current' },
  { id: 'check', label: 'Check', status: 'upcoming' },
];

describe('Steps', () => {
  it('is a labelled ordered list that writes each state out, so colour is never the only signal', () => {
    const out = renderToStaticMarkup(<Steps label="Setup steps" steps={steps} />);
    expect(out).toMatch(/^<ol aria-label="Setup steps"/);
    expect(out.match(/<li/g)).toHaveLength(4);
    for (const key of ['stepDone', 'stepFailed', 'stepCurrent', 'stepUpcoming'] as const) expect(out).toContain(messages.id[key]);
    expect(out).toContain('exit 1');
  });

  it('marks only the running step as the current one', () => {
    const out = renderToStaticMarkup(<Steps label="x" steps={steps} />);
    expect(out.match(/aria-current="step"/g)).toHaveLength(1);
  });

  it('turns every step into a pressable button when it can be selected', () => {
    const out = renderToStaticMarkup(<Steps label="x" steps={steps} selected="build" onSelect={() => undefined} />);
    expect(out.match(/<button/g)).toHaveLength(4);
    expect(out.match(/aria-pressed="true"/g)).toHaveLength(1);
  });
});

describe('Modal and Toaster', () => {
  it('renders nothing while the dialog is closed', () => {
    expect(renderToStaticMarkup(<Modal open={false} onClose={() => undefined} title="Archive?">body</Modal>)).toBe('');
  });

  it('keeps one polite live region for toasts, empty until something happens', () => {
    const out = renderToStaticMarkup(<Toaster />);
    expect(out).toContain('role="status"');
    expect(out).toContain('aria-live="polite"');
    expect(out).not.toContain('<button');
  });
});

describe('ErrorBoundary', () => {
  it('shows what happened and a reload button instead of an empty box once a screen has crashed', () => {
    expect(ErrorBoundary.getDerivedStateFromError()).toEqual({ failed: true });
    const boundary = new ErrorBoundary({ children: 'the screen' });
    expect(renderToStaticMarkup(<>{boundary.render()}</>)).toContain('the screen');
    boundary.state = { failed: true };
    const html = renderToStaticMarkup(<>{boundary.render()}</>);
    expect(html).toContain('role="alert"');
    expect(html).not.toContain('the screen');
    expect(html).toMatch(/Muat ulang|Reload/);
  });
});
