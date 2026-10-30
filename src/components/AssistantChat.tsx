import { useEffect, useRef } from 'react';
import { useT } from '../lib/use-t';
import { Composer, Conversation } from './assistant/Conversation';
import { useAssistant } from './assistant/useAssistant';
import { Button } from './ui/Button';

type Role = 'owner' | 'admin' | 'staff';

/**
 * The assistant page, full screen. It talks only about the organization: facts come from the tools behind
 * `/api/ai/chat`, the sources are shown under each answer, and anything outside the business gets a fixed refusal
 * (D-049). The same conversation is open in the side panel on every other page.
 */
export function AssistantChat({ role }: { role: Role }) {
  const t = useT();
  const { turns, busy, ask, retry, clear } = useAssistant();
  const composer = useRef<HTMLTextAreaElement>(null);

  // `/app/asisten?q=…` arrives with a question (from the dashboard or the command palette): ask it once.
  useEffect(() => {
    const url = new URL(window.location.href);
    const q = url.searchParams.get('q');
    if (!q) return;
    url.searchParams.delete('q');
    window.history.replaceState(null, '', url);
    ask(q);
  }, []);

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col gap-3 lg:gap-4">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3">
        <div className="max-w-prose">
          <h1 className="m-0 text-2xl font-semibold text-ink lg:text-3xl">{t('assistantTitle')}</h1>
          <p className="mt-1 mb-0 hidden text-muted md:block">{t('assistantIntro')}</p>
        </div>
        {turns.length > 0 && (
          <Button size="sm" onClick={() => { clear(); composer.current?.focus(); }} disabled={busy}>{t('assistantClear')}</Button>
        )}
      </header>

      <section className="-mx-2 flex min-h-0 flex-1 flex-col overflow-y-auto px-2 py-2" aria-label={t('assistantTitle')}>
        <Conversation turns={turns} busy={busy} role={role} onAsk={ask} onRetry={retry} />
      </section>

      <Composer ref={composer} busy={busy} onSend={ask} />
    </div>
  );
}
