import { Component, type ReactNode } from 'react';
import { translate, getLocale } from '../../lib/i18n';
import { Button } from './Button';
import { Panel } from './Panel';

/**
 * Keeps a crash inside one screen from turning it into an empty box (company profile bug, 2026-10-31): the person is told
 * something went wrong and can reload, instead of staring at nothing. It cannot repair the error; it only makes it visible.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error('screen crashed', error instanceof Error ? error.message : error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const t = (key: 'crashTitle' | 'crashHelp' | 'crashReload') => translate(getLocale(), key);
    return (
      <Panel role="alert" className="flex flex-col items-start gap-3">
        <h2 className="m-0 text-lg font-semibold text-ink">{t('crashTitle')}</h2>
        <p className="m-0 max-w-prose text-sm text-muted">{t('crashHelp')}</p>
        <Button variant="primary" onClick={() => window.location.reload()}>{t('crashReload')}</Button>
      </Panel>
    );
  }
}
